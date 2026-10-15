using System;
using System.IO;
using System.Text;
using System.Drawing;
using System.Drawing.Printing;
using System.Windows.Forms;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using System.Collections.Generic;
using System.Threading;

public class RdpControl : AxHost {
    public RdpControl() : base("8B918B82-7985-4C24-89DF-C33AD2BBFBCD") {}
    public object ControlObject { get { return GetOcx(); } }
}
public static class NativeHost {
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
    static JavaScriptSerializer json = new JavaScriptSerializer();
    static void Output(object value) { Console.WriteLine(json.Serialize(value)); Console.Out.Flush(); }
    [STAThread] public static int Main() {
        Console.InputEncoding = new UTF8Encoding(false); Console.OutputEncoding = new UTF8Encoding(false);
        try {
            string line = Console.ReadLine(); if (line == null || line.Length > 65536) return 1;
            var input = json.Deserialize<Dictionary<string, object>>(line); string op = (string)input["op"];
            if (op == "xserverProbe") { Output(XServerHost.Probe((string)input["executable"])); return 0; }
            if (op == "xserver") { XServerHost.Run(input); return 0; }
            if (op == "printers") { var names = new List<string>(); foreach (string printer in PrinterSettings.InstalledPrinters) names.Add(printer); Output(new { printers = names }); return 0; }
            if (op == "print") {
                string path = (string)input["path"], printer = (string)input["printer"], name = "Hornet " + (string)input["jobId"];
                if ((string)input["mode"] == "text") { PrintText(path, printer, name); Output(new { submitted = true }); }
                else { int id = PrintRaw(path, printer, name); Output(new { submitted = true, osJobId = id }); }
                return 0;
            }
            if (op != "rdp" && op != "rdpProbe") return 1;
            Application.EnableVisualStyles();
            using (var form = new Form()) using (var control = new RdpControl()) using (var icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath)) {
                form.Icon = icon; form.Text = "Hornet · RDP"; form.Width = 1280; form.Height = 800;
                control.Dock = DockStyle.Fill; form.Controls.Add(control);
                if (op == "rdpProbe") { form.ShowInTaskbar = false; form.Opacity = 0; }
                dynamic rdp = null; bool parentClosed = false;
                form.Shown += delegate {
                    try {
                        if (parentClosed) { form.Close(); return; }
                        rdp = control.ControlObject;
                        dynamic settings = rdp.AdvancedSettings8;
                        settings.EnableCredSspSupport = true;
                        settings.AuthenticationLevel = 1;
                        settings.RedirectClipboard = false; settings.RedirectDrives = false;
                        settings.RedirectPrinters = false; settings.RedirectPorts = false;
                        settings.RedirectSmartCards = false; settings.RedirectDevices = false;
                        settings.AudioRedirectionMode = 2;
                        settings.EnableAutoReconnect = false;
                        if (op == "rdpProbe") { Output(new { available = true, presentation = "managed-native-window" }); form.Close(); return; }
                        ShowWindow(form.Handle, 5); SetForegroundWindow(form.Handle);
                        rdp.Server = (string)input["host"]; rdp.UserName = (string)input["username"];
                        rdp.Domain = (string)input["domain"];
                        rdp.DesktopWidth = 1280; rdp.DesktopHeight = 720;
                        settings.RDPPort = Convert.ToInt32(input["port"]);
                        settings.ClearTextPassword = (string)input["password"]; input.Remove("password"); line = null;
                        Guid events = new Guid("336D5562-EFA8-482E-8CB3-C5C0FC7A7DB6");
                        ComEventsHelper.Combine(control.ControlObject, events, 2, new Action(delegate { Output(new { state = "connected" }); }));
                        ComEventsHelper.Combine(control.ControlObject, events, 4, new Action<int>(delegate(int reason) { Output(new { state = "disconnected", reason = reason }); form.Close(); }));
                        rdp.Connect(); Output(new { state = "connecting" });
                    } catch { Output(new { error = "RDP control initialization or security configuration failed" }); form.Close(); }
                };
                form.FormClosing += delegate { try { if (rdp != null && rdp.Connected != 0) rdp.Disconnect(); } catch {} };
                if (op == "rdp") {
                    var monitor = new Thread(delegate() { Console.ReadLine(); parentClosed = true; try { if (form.IsHandleCreated) form.BeginInvoke(new Action(delegate { form.Close(); })); } catch {} });
                    monitor.IsBackground = true; monitor.Start();
                }
                Application.Run(form);
            }
            return 0;
        } catch { Output(new { error = "Native operation failed" }); return 1; }
    }
    static void PrintText(string path, string printer, string name) {
        string text = new UTF8Encoding(false, true).GetString(File.ReadAllBytes(path));
        int offset = 0, pages = 0;
        using (var doc = new PrintDocument()) using (var font = new Font("Consolas", 10)) {
            doc.PrinterSettings.PrinterName = printer;
            if (!doc.PrinterSettings.IsValid) throw new Exception();
            doc.DocumentName = name; doc.PrintController = new StandardPrintController();
            doc.DefaultPageSettings.Margins = new Margins(50, 50, 50, 50);
            doc.PrintPage += delegate(object sender, PrintPageEventArgs e) {
                if (++pages > 1000) throw new Exception();
                int fitted, lines;
                e.Graphics.MeasureString(text.Substring(offset), font, e.MarginBounds.Size, StringFormat.GenericTypographic, out fitted, out lines);
                if (fitted == 0 && offset < text.Length) throw new Exception();
                e.Graphics.DrawString(text.Substring(offset, fitted), font, Brushes.Black, e.MarginBounds, StringFormat.GenericTypographic);
                offset += fitted; e.HasMorePages = offset < text.Length;
            };
            doc.Print();
        }
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct DocInfo { public string name; public string output; public string type; }
    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] static extern int StartDocPrinter(IntPtr handle, int level, ref DocInfo info);
    [DllImport("winspool.drv")] static extern bool EndDocPrinter(IntPtr handle);
    [DllImport("winspool.drv")] static extern bool ClosePrinter(IntPtr handle);
    [DllImport("winspool.drv")] static extern bool AbortPrinter(IntPtr handle);
    [DllImport("winspool.drv", SetLastError = true)] static extern bool WritePrinter(IntPtr handle, byte[] bytes, int count, out int written);
    static int PrintRaw(string path, string printer, string name) {
        IntPtr handle; if (!OpenPrinter(printer, out handle, IntPtr.Zero)) throw new Exception();
        try {
            var info = new DocInfo { name = name, type = "RAW" };
            int id = StartDocPrinter(handle, 1, ref info); if (id == 0) throw new Exception();
            try {
                using (var file = File.OpenRead(path)) { byte[] buffer = new byte[65536]; int size;
                    while ((size = file.Read(buffer, 0, buffer.Length)) != 0) { int sent; if (!WritePrinter(handle, buffer, size, out sent) || sent != size) throw new Exception(); }
                }
                if (!EndDocPrinter(handle)) throw new Exception(); return id;
            } catch { AbortPrinter(handle); throw; }
        } finally { ClosePrinter(handle); }
    }
}

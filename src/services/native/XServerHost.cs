using System;
using System.IO;
using System.Diagnostics;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using System.Web.Script.Serialization;
using System.Threading;

// Owns exactly one engine. Closing stdin or losing the helper closes its Job Object.
public static class XServerHost {
    [StructLayout(LayoutKind.Sequential)] struct BasicLimits { public long processTime,jobTime; public uint flags; public UIntPtr minWorking,maxWorking; public uint activeProcesses; public UIntPtr affinity; public uint priority,scheduling; }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong a,b,c,d,e,f; }
    [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits { public BasicLimits basic; public IoCounters io; public UIntPtr processMemory,jobMemory,peakProcess,peakJob; }
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
    [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr job,int type,ref ExtendedLimits limits,uint size);
    [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    static void Output(object value) { Console.WriteLine(new JavaScriptSerializer().Serialize(value)); Console.Out.Flush(); }
    public static object Probe(string executable) {
        if(!Path.IsPathRooted(executable)||!String.Equals(Path.GetFileName(executable),"vcxsrv.exe",StringComparison.OrdinalIgnoreCase)||!File.Exists(executable)) throw new Exception("Invalid engine");
        var info=FileVersionInfo.GetVersionInfo(executable);
        return new { version=info.FileVersion ?? "unknown", name=info.FileDescription ?? "VcXsrv" };
    }
    static string Quote(string value) {
        if(value.IndexOf('"')>=0||value.IndexOf('\r')>=0||value.IndexOf('\n')>=0)throw new Exception("Invalid argument");
        return "\""+value+"\"";
    }
    public static void Run(Dictionary<string,object> input) {
        string executable=(string)input["executable"]; Probe(executable);
        string folder=Path.GetFullPath((string)input["folder"]);
        if(Directory.Exists(folder))throw new Exception("Session directory already exists");
        var acl=new DirectorySecurity(); acl.SetAccessRuleProtection(true,false);
        var sid=WindowsIdentity.GetCurrent().User;
        acl.AddAccessRule(new FileSystemAccessRule(sid,FileSystemRights.FullControl,InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit,PropagationFlags.None,AccessControlType.Allow));
        Directory.CreateDirectory(folder,acl);
        IntPtr job=IntPtr.Zero; Process child=null;
        try {
            string authority=Path.Combine(folder,"authority");
            byte[] bytes=Convert.FromBase64String((string)input["authority"]);
            File.WriteAllBytes(authority,bytes); Array.Clear(bytes,0,bytes.Length); input.Remove("authority");
            int display=Convert.ToInt32(input["display"]),dpi=Convert.ToInt32(input["dpi"]);
            if(display<10||display>99||dpi<72||dpi>240)throw new Exception("Invalid display");
            string args=":"+display+" -auth "+Quote(authority)+" -listen tcp -nolisten inet6 -noclipboard -nowgl -dpi "+dpi+" -logfile "+Quote(Path.Combine(folder,"server.log"));
            if(input.ContainsKey("host")) {
                string host=(string)input["host"],local=(string)input["localAddress"];
                System.Net.IPAddress address;
                if(!System.Net.IPAddress.TryParse(host,out address)||!System.Net.IPAddress.TryParse(local,out address))throw new Exception("Invalid XDMCP address");
                args+=" -port "+Convert.ToInt32(input["port"])+" -from "+local+" -query "+host+" -once";
            } else {args+=" -noreset";if((string)input["mode"]=="multiWindow")args+=" -multiwindow";}
            job=CreateJobObject(IntPtr.Zero,null);
            var limits=new ExtendedLimits();limits.basic.flags=0x2000; // KILL_ON_JOB_CLOSE
            if(job==IntPtr.Zero||!SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(limits)))throw new Exception("Cannot create job");
            child=new Process(); child.StartInfo=new ProcessStartInfo(executable,args) { UseShellExecute=false,CreateNoWindow=true,WorkingDirectory=Path.GetDirectoryName(executable),RedirectStandardOutput=true,RedirectStandardError=true };
            child.OutputDataReceived+=delegate{};child.ErrorDataReceived+=delegate{};
            child.Start();
            if(!AssignProcessToJobObject(job,child.Handle)){child.Kill();throw new Exception("Cannot own engine process");}
            child.BeginOutputReadLine();child.BeginErrorReadLine();
            Output(new { state="started",pid=child.Id });
            var monitor=new Thread(delegate(){Console.ReadLine();try{if(!child.HasExited)child.Kill();}catch{}}); monitor.IsBackground=true;monitor.Start();
            child.WaitForExit();Output(new { state="exited",code=child.ExitCode });
        } finally {
            if(job!=IntPtr.Zero)CloseHandle(job);
            if(child!=null){try{if(!child.HasExited){child.Kill();child.WaitForExit(2000);}}catch{}child.Dispose();}
            try{Directory.Delete(folder,true);}catch{}
        }
    }
}

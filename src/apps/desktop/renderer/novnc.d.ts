declare module '@novnc/novnc' {
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, channel: WebSocket, options?: object);
    scaleViewport: boolean; resizeSession: boolean; viewOnly: boolean;
    disconnect(): void; sendCredentials(credentials: { password: string; username?: string }): void;
    sendCtrlAltDel(): void; focus(): void;
  }
}

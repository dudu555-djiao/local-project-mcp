import Foundation

// readyz checks local lifecycle, not successful OpenAI polling.
func tunnelConnectionAssessment(ready: Bool, metrics: String?, now: TimeInterval = Date().timeIntervalSince1970) -> (state: String, detail: String) {
    guard ready else { return ("starting", "本地连接客户端尚未就绪，正在等待启动。") }
    guard let metrics=metrics else { return ("starting", "本地客户端已就绪，尚无法确认 OpenAI 通道连接。") }
    func value(_ name: String) -> Double? {
        for line in metrics.split(separator: "\n") where line.hasPrefix(name+"{") || line.hasPrefix(name+" ") {
            if let raw=line.split(separator: " ").last, let number=Double(raw), number.isFinite { return number }
        }
        return nil
    }
    guard let last=value("commands_poll_last_successful_timestamp_seconds") else {
        return ("starting", "本地客户端已就绪，尚无法确认 OpenAI 通道连接。")
    }
    if last>0 && now-last>=0 && now-last<=90 {
        return ("connected", "已确认近期成功连接 OpenAI 通道。请在 ChatGPT 中创建并调用插件，完成读取验证。")
    }
    if (value("commands_poll_errors_total") ?? 0)>0 {
        return ("starting", "本地 MCP 正常，但 OpenAI 通道未连通。请检查网络、HTTPS 代理、运行密钥及 Tunnel 权限。")
    }
    return ("starting", "本地客户端已就绪，正在等待成功连接 OpenAI 通道。")
}

import Cocoa
import WebKit
import Security
import PDFKit

func emitJSON(_ value: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: value), let s = String(data: data, encoding: .utf8) { print(s) }
}
func extractPDF(_ filename: String) {
    guard let doc = PDFDocument(url: URL(fileURLWithPath: filename)), !doc.isLocked else { emitJSON(["error":"PDF 无法读取，或需要密码。"]); return }
    let count = min(doc.pageCount, 100)
    var parts: [String] = [], chars = 0, extracted = 0
    for i in 0..<count {
        let s = doc.page(at: i)?.string ?? ""
        if chars + s.utf8.count > 1_400_000 { break }
        parts.append("[第 \(i+1) 页]\n" + s); chars += s.utf8.count; extracted += 1
    }
    if parts.joined().trimmingCharacters(in: .whitespacesAndNewlines).count < count * 8 {
        emitJSON(["error":"此 PDF 没有足够的可选文本；本版本不执行 OCR，请先导出文本。"]); return
    }
    emitJSON(["text":parts.joined(separator:"\n\n"),"pages":doc.pageCount,"extractedPages":extracted,"truncated":extracted < doc.pageCount])
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKScriptMessageHandler, WKNavigationDelegate {
    var window: NSWindow!, web: WKWebView!, item: NSStatusItem!, loadingLabel:NSTextField!, loadingSpinner:NSProgressIndicator!
    var backendPipe:Pipe?, backendErrorPipe:Pipe?, tunnelPipe:Pipe?
    var backend: Process?, tunnel: Process?, backendOutput = Data(), tunnelOutput = ""
    var adminToken = UUID().uuidString + UUID().uuidString, mcpToken = UUID().uuidString + UUID().uuidString
    var port = 0, ready = false, quitting = false
    var tunnelID = "", organization = "", proxy = "", runtimeKey = "", rememberKey = false
    var tunnelState = "unconfigured", detail = "", healthURL: URL?, healthCheckRunning = false
    var lastTunnelError = "", healthTimer: Timer?
    let keychainService = "io.localreader.mcp.tunnel"
    let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!.appendingPathComponent("LocalReaderMCP", isDirectory:true)
    var resources: URL { Bundle.main.resourceURL! }
    var connectionFile: URL { appSupport.appendingPathComponent("connection.json") }
    var healthFile: URL { appSupport.appendingPathComponent("tunnel-health.url") }
    func diagnostic(_ s:String){
        let u=appSupport.appendingPathComponent("startup.log")
        let d=Data((s+"\n").utf8)
        if let h=try? FileHandle(forWritingTo:u){_ = try? h.seekToEnd();try? h.write(contentsOf:d);try? h.close()}else{try? d.write(to:u);try? FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:u.path)}
    }
    func runtimeEnvironment()->[String:String]{
        // Avoid inheriting Node preload settings, Tunnel profiles, extra targets,
        // logging flags, API endpoints or credentials from the parent process.
        let inherited=ProcessInfo.processInfo.environment
        var result:[String:String]=[:]
        for key in ["PATH","HOME","TMPDIR","LANG","LC_ALL","LC_CTYPE","TZ"]{if let value=inherited[key]{result[key]=value}}
        return result
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let others = NSRunningApplication.runningApplications(withBundleIdentifier: "io.localreader.mcp").filter { $0.processIdentifier != ProcessInfo.processInfo.processIdentifier }
        if let existing = others.first { existing.activate(options:[.activateAllWindows]); NSApp.terminate(nil); return }
        try? FileManager.default.createDirectory(at:appSupport,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
        try? Data().write(to:appSupport.appendingPathComponent("startup.log"),options:.atomic)
        try? FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:appSupport.appendingPathComponent("startup.log").path)
        loadConnection()
        let config = WKWebViewConfiguration(); config.userContentController.add(self,name:"localReader")
        web = WKWebView(frame:NSRect(x:0,y:0,width:1120,height:780),configuration:config);web.navigationDelegate=self
        web.autoresizingMask=[.width,.height]
        window = NSWindow(contentRect:NSRect(x:0,y:0,width:1120,height:780),styleMask:[.titled,.closable,.miniaturizable,.resizable],backing:.buffered,defer:false)
        window.title="本地项目助手";window.minSize=NSSize(width:950,height:650);window.center();window.delegate=self
        let container=NSView(frame:NSRect(x:0,y:0,width:1120,height:780));window.contentView=container
        web.translatesAutoresizingMaskIntoConstraints=false;container.addSubview(web)
        NSLayoutConstraint.activate([web.leadingAnchor.constraint(equalTo:container.leadingAnchor),web.trailingAnchor.constraint(equalTo:container.trailingAnchor),web.topAnchor.constraint(equalTo:container.topAnchor),web.bottomAnchor.constraint(equalTo:container.bottomAnchor)])
        loadingLabel=NSTextField(labelWithString:"正在启动本地项目助手…");loadingLabel.translatesAutoresizingMaskIntoConstraints=false;container.addSubview(loadingLabel)
        loadingSpinner=NSProgressIndicator();loadingSpinner.style = .spinning;loadingSpinner.translatesAutoresizingMaskIntoConstraints=false;container.addSubview(loadingSpinner);loadingSpinner.startAnimation(nil)
        NSLayoutConstraint.activate([loadingLabel.centerXAnchor.constraint(equalTo:container.centerXAnchor),loadingLabel.centerYAnchor.constraint(equalTo:container.centerYAnchor),loadingSpinner.centerXAnchor.constraint(equalTo:container.centerXAnchor),loadingSpinner.bottomAnchor.constraint(equalTo:loadingLabel.topAnchor,constant:-16)])
        window.setFrameAutosaveName("LocalReaderMainWindow")
        item = NSStatusBar.system.statusItem(withLength:NSStatusItem.squareLength)
        item.button?.image=NSImage(systemSymbolName:"folder.badge.gearshape",accessibilityDescription:"本地项目助手")
        let menu=NSMenu();menu.addItem(withTitle:"打开本地项目助手",action:#selector(showWindow),keyEquivalent:"").target=self
        menu.addItem(withTitle:"暂停 / 恢复全部访问",action:#selector(togglePause),keyEquivalent:"").target=self
        menu.addItem(NSMenuItem.separator());menu.addItem(withTitle:"退出",action:#selector(quit),keyEquivalent:"q").target=self;item.menu=menu
        let mainMenu=NSMenu(), appMenu=NSMenu(), root=NSMenuItem();root.submenu=appMenu
        appMenu.addItem(withTitle:"关于本地项目助手",action:#selector(about),keyEquivalent:"").target=self
        appMenu.addItem(withTitle:"显示窗口",action:#selector(showWindow),keyEquivalent:"0").target=self
        appMenu.addItem(NSMenuItem.separator());appMenu.addItem(withTitle:"退出本地项目助手",action:#selector(quit),keyEquivalent:"q").target=self
        mainMenu.addItem(root)
        let edit=NSMenu(title:"编辑"), editItem=NSMenuItem(title:"编辑",action:nil,keyEquivalent:"");editItem.submenu=edit
        edit.addItem(withTitle:"复制",action:#selector(NSText.copy(_:)),keyEquivalent:"c");edit.addItem(withTitle:"粘贴",action:#selector(NSText.paste(_:)),keyEquivalent:"v");edit.addItem(withTitle:"剪切",action:#selector(NSText.cut(_:)),keyEquivalent:"x");edit.addItem(withTitle:"全选",action:#selector(NSText.selectAll(_:)),keyEquivalent:"a");mainMenu.addItem(editItem);NSApp.mainMenu=mainMenu
        window.makeKeyAndOrderFront(nil);NSApp.activate(ignoringOtherApps:true)
        launchBackend()
        DispatchQueue.main.asyncAfter(deadline:.now()+10){[weak self] in guard let self=self,!self.ready else{return};self.loadingLabel.stringValue="正在重新加载管理界面…";if self.port>0{self.loadUI()}else{self.loadingLabel.stringValue="本地服务尚未就绪，请退出后重新打开应用。";self.loadingSpinner.stopAnimation(nil)}}
        healthTimer=Timer.scheduledTimer(withTimeInterval:3,repeats:true){[weak self] _ in self?.checkHealth()}
    }
    @objc func showWindow(){window?.makeKeyAndOrderFront(nil);NSApp.activate(ignoringOtherApps:true)}
    @objc func quit(){NSApp.terminate(nil)}
    @objc func about(){let a=NSAlert();a.messageText="本地项目助手 0.2.0-beta.2";a.informativeText="默认只读，按项目授权编辑的资料 MCP。\n支持搜索、文档读取、修改预览、文件编辑、本地备份恢复和 OpenAI Tunnel 连接。\n关闭窗口后仍在菜单栏运行；退出会停止连接。";a.runModal()}
    func windowShouldClose(_ sender:NSWindow)->Bool{sender.orderOut(nil);return false}
    func applicationShouldTerminateAfterLastWindowClosed(_ sender:NSApplication)->Bool{return false}
    func applicationWillTerminate(_ notification:Notification){quitting=true;healthTimer?.invalidate();stopTunnel();backend?.terminate();if let b=backend,b.isRunning { b.waitUntilExit() }}
    func loadConnection(){
        if let d=try? Data(contentsOf:connectionFile),let c=try? JSONSerialization.jsonObject(with:d) as? [String:Any]{tunnelID=c["tunnelId"] as? String ?? "";organization=c["organization"] as? String ?? "";proxy=c["proxy"] as? String ?? "";rememberKey=c["rememberKey"] as? Bool ?? false}
        tunnelState=tunnelID.isEmpty ? "unconfigured":"configured"
    }
    func keychainKey()->String?{
        let q:[String:Any]=[kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:keychainService,kSecAttrAccount as String:"runtime",kSecReturnData as String:true,kSecMatchLimit as String:kSecMatchLimitOne]
        var out:CFTypeRef?;guard SecItemCopyMatching(q as CFDictionary,&out)==errSecSuccess,let d=out as? Data else{return nil};return String(data:d,encoding:.utf8)
    }
    func saveKey(_ key:String)->Bool{
        let q:[String:Any]=[kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:keychainService,kSecAttrAccount as String:"runtime"]
        let attributes:[String:Any]=[kSecValueData as String:Data(key.utf8),kSecAttrAccessible as String:kSecAttrAccessibleWhenUnlocked]
        let result=SecItemUpdate(q as CFDictionary,attributes as CFDictionary)
        if result==errSecItemNotFound{var add=q;attributes.forEach{add[$0]=$1};return SecItemAdd(add as CFDictionary,nil)==errSecSuccess};return result==errSecSuccess
    }
    func deleteKey(){SecItemDelete([kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:keychainService,kSecAttrAccount as String:"runtime"] as CFDictionary)}
    func send(_ data:[String:Any]){
        guard ready,let d=try? JSONSerialization.data(withJSONObject:data),let s=String(data:d,encoding:.utf8) else{return}
        web.evaluateJavaScript("window.nativeEvent(\(s))",completionHandler:nil)
    }
    func connectionStatus(){send(["type":"connection","state":tunnelState,"tunnelId":tunnelID,"detail":detail,"clientAvailable":FileManager.default.isExecutableFile(atPath:resources.appendingPathComponent("bin/tunnel-client").path)])}
    func toast(_ text:String,error:Bool=false){send(["type":"toast","message":text,"error":error])}
    func api(_ route:String, data:[String:Any]?=nil, completion:@escaping([String:Any]?,String?)->Void){
        guard port>0,let url=URL(string:"http://127.0.0.1:\(port)/api/\(route)") else{completion(nil,"本地服务尚未启动。");return}
        var r=URLRequest(url:url);r.setValue(adminToken,forHTTPHeaderField:"X-LocalReader-Token");r.timeoutInterval=20
        if let data=data{r.httpMethod="POST";r.setValue("application/json",forHTTPHeaderField:"Content-Type");r.httpBody=try? JSONSerialization.data(withJSONObject:data)}
        URLSession.shared.dataTask(with:r){d,res,e in
            let out=d.flatMap{try? JSONSerialization.jsonObject(with:$0) as? [String:Any]}
            let error=e?.localizedDescription ?? (((res as? HTTPURLResponse)?.statusCode ?? 500)>=400 ? out?["error"] as? String ?? "本地请求失败":nil)
            DispatchQueue.main.async{completion(out,error)}
        }.resume()
    }
    @objc func togglePause(){api("state"){[weak self]c,e in guard let self=self,let c=c,e==nil else{return};self.api("pause",data:["paused":!(c["paused"] as? Bool ?? false)]){_,_ in self.send(["type":"refresh"])}}}
    func launchBackend(){
        let p=Process();backend=p;p.executableURL=resources.appendingPathComponent("bin/node");p.arguments=[resources.appendingPathComponent("service/src/server.js").path]
        var env=runtimeEnvironment();env["LOCALREADER_DATA_DIR"]=appSupport.path;env["LOCALREADER_ADMIN_TOKEN"]=adminToken;env["LOCALREADER_MCP_TOKEN"]=mcpToken;env["LOCALREADER_PORT"]="0";env["LOCALREADER_EXTRACTOR"]=Bundle.main.executableURL!.path;p.environment=env
        let output=Pipe(),errors=Pipe();backendPipe=output;backendErrorPipe=errors;p.standardOutput=output;p.standardError=errors
        output.fileHandleForReading.readabilityHandler={[weak self]h in let d=h.availableData;if d.isEmpty{return};DispatchQueue.main.async{self?.processBackendOutput(d)}}
        errors.fileHandleForReading.readabilityHandler={h in _=h.availableData}
        p.terminationHandler={[weak self]_ in DispatchQueue.main.async{guard let self=self,!self.quitting else{return};self.detail="本地资料服务意外停止。请退出并重新打开应用。";self.toast(self.detail,error:true)}}
        do{try p.run()}catch{let a=NSAlert();a.messageText="本地服务无法启动";a.informativeText=error.localizedDescription;a.runModal();NSApp.terminate(nil)}
    }
    func processBackendOutput(_ d:Data){
        diagnostic("Output bytes \(d.count)")
        guard port==0 else{return};backendOutput.append(d)
        guard let line=String(data:backendOutput,encoding:.utf8)?.split(separator:"\n").first,let bytes=String(line).data(using:.utf8),let obj=try? JSONSerialization.jsonObject(with:bytes) as? [String:Any],let n=obj["port"] as? Int else{return}
        port=n;DispatchQueue.main.async{[weak self] in self?.loadUI()}
        diagnostic("Loaded request \(port), web \(web.frame)")
    }
    func loadUI(){
        window.contentView?.layoutSubtreeIfNeeded()
        web.load(URLRequest(url:URL(string:"http://127.0.0.1:\(port)/#token=\(adminToken)")!))
    }
    func webView(_ webView:WKWebView,didFinish navigation:WKNavigation!){
        diagnostic("Finish \(webView.url?.host ?? "none") \(webView.url?.port ?? 0) web \(web.frame)")
        guard webView.url?.host=="127.0.0.1",webView.url?.port==port else{return}
        webView.evaluateJavaScript("typeof window.nativeEvent === 'function' && document.getElementById('addFolder') !== null"){[weak self]result,error in
            guard let self=self else{return}
            if result as? Bool == true{self.ready=true;self.loadingLabel.isHidden=true;self.loadingSpinner.stopAnimation(nil);self.loadingSpinner.isHidden=true;self.connectionStatus()}
            else{self.loadingLabel.stringValue="管理界面尚未就绪，正在等待重新加载。";self.diagnostic("UI script not ready")}
        }
    }
    func webView(_ webView:WKWebView,didFailProvisionalNavigation navigation:WKNavigation!,withError error:Error){
        let a=NSAlert();a.messageText="管理界面加载失败";a.informativeText=error.localizedDescription;a.beginSheetModal(for:window,completionHandler:nil)
    }
    func webView(_ webView:WKWebView,decidePolicyFor navigationAction:WKNavigationAction,decisionHandler:@escaping(WKNavigationActionPolicy)->Void){
        diagnostic("Navigation \(navigationAction.request.url?.host ?? "none") \(navigationAction.request.url?.port ?? 0) expected \(port)")
        guard let u=navigationAction.request.url,u.scheme=="http",u.host=="127.0.0.1",u.port==port else{decisionHandler(.cancel);return};decisionHandler(.allow)
    }
    func userContentController(_ userContentController:WKUserContentController,didReceive message:WKScriptMessage){
        // WebKit's frame request can omit its URL for script messages. Check the
        // actual loaded main document, whose navigation is restricted above.
        guard message.frameInfo.isMainFrame,let u=web.url,u.host=="127.0.0.1",u.port==port,let b=message.body as? [String:Any],let action=b["action"] as? String else{return}
        switch action{
        case "chooseFolder":
            let panel=NSOpenPanel();panel.canChooseDirectories=true;panel.canChooseFiles=false;panel.allowsMultipleSelection=false;panel.prompt="添加资料";panel.message="选择允许 ChatGPT 读取的项目或资料文件夹。"
            panel.beginSheetModal(for:window){[weak self]r in if r == .OK,let url=panel.url{self?.send(["type":"folderSelected","path":url.path])}}
        case "renameFolder":
            guard let id=b["id"] as? String,let name=b["name"] as? String else{return}
            let a=NSAlert();a.messageText="重命名资料";a.informativeText="只修改显示名称，原始文件夹保持不变。";a.addButton(withTitle:"保存");a.addButton(withTitle:"取消");let field=NSTextField(string:name);field.frame=NSRect(x:0,y:0,width:300,height:28);a.accessoryView=field
            a.beginSheetModal(for:window){[weak self]r in if r == .alertFirstButtonReturn{self?.send(["type":"rename","id":id,"name":field.stringValue])}}
        case "setEditing":
            if let id=b["id"] as? String,let editable=b["editable"] as? Bool{setEditing(id,editable:editable)}
        case "restoreChange":
            if let id=b["id"] as? String,let changeID=b["changeId"] as? String{restoreChange(id,changeID:changeID)}
        case "exportFolder":if let id=b["id"] as? String{exportFolder(id)}
        case "configureTunnel":configureTunnel()
        case "startTunnel":startTunnel()
        case "stopTunnel":stopTunnel();tunnelState=tunnelID.isEmpty ? "unconfigured":"stopped";detail="连接已停止。";connectionStatus()
        case "status":connectionStatus()
        case "openLink":
            let urls=["tunnels":"https://platform.openai.com/settings/organization/tunnels","chatgpt":"https://chatgpt.com/plugins"]
            if let which=b["which"] as? String,let text=urls[which],let url=URL(string:text){NSWorkspace.shared.open(url)}
        case "openDiagnostics":if let u=healthURL{NSWorkspace.shared.open(u.appendingPathComponent("ui"))}else{toast("连接启动后，才会提供诊断页面。")}
        case "copy":if let s=b["text"] as? String,s.count<10000{NSPasteboard.general.clearContents();NSPasteboard.general.setString(s,forType:.string);toast("已复制。")}
        default:break
        }
    }
    func setEditing(_ id:String,editable:Bool){
        if !editable{send(["type":"editing","id":id,"editable":false]);return}
        // Read the real local folder record rather than trusting a display name
        // or path supplied by the page message.
        api("state"){[weak self]out,error in
            guard let self=self else{return}
            if let error=error{self.toast(error,error:true);return}
            guard let folder=(out?["folders"] as? [[String:Any]])?.first(where:{$0["id"] as? String==id}),let name=folder["name"] as? String,let path=folder["path"] as? String else{self.toast("项目已移除，请刷新列表。",error:true);return}
            let a=NSAlert();a.alertStyle = .warning;a.messageText="允许 ChatGPT 编辑这个项目？"
            a.informativeText="\(name)\n\(path)\n\n开启后，网页端 ChatGPT 可以通过本助手创建或修改此目录内允许访问的 UTF-8 文本和源码。每次修改须先生成预览，再调用应用工具；ChatGPT 的写入确认由其自身设置控制。\n\n修改前内容会保存在本机备份中。你可以随时关闭编辑、停用项目或暂停全部访问。本版不执行任意终端命令、SQL 或删除文件。"
            a.addButton(withTitle:"允许编辑");a.addButton(withTitle:"取消");a.buttons[0].keyEquivalent="";a.buttons[1].keyEquivalent="\r"
            a.beginSheetModal(for:self.window){[weak self]r in if r == .alertFirstButtonReturn{self?.send(["type":"editing","id":id,"editable":true])}}
        }
    }
    func restoreChange(_ id:String,changeID:String){
        api("state"){[weak self]state,error in
            guard let self=self else{return}
            if let error=error{self.toast(error,error:true);return}
            guard let folder=(state?["folders"] as? [[String:Any]])?.first(where:{$0["id"] as? String==id}),let name=folder["name"] as? String,folder["editable"] as? Bool==true,folder["enabled"] as? Bool==true,state?["paused"] as? Bool != true else{self.toast("请先恢复访问并允许此项目编辑。",error:true);return}
            self.api("changes",data:["id":id]){[weak self]out,error in
                guard let self=self else{return}
                if let error=error{self.toast(error,error:true);return}
                guard let change=(out?["changes"] as? [[String:Any]])?.first(where:{$0["id"] as? String==changeID}),let path=change["path"] as? String,change["canRestore"] as? Bool==true else{self.toast("此记录没有可恢复的旧内容；新建文件不会被删除。",error:true);return}
                let a=NSAlert();a.alertStyle = .warning;a.messageText="恢复到这次修改前？";a.informativeText="\(name)\n\(path)\n\n本助手会用本机备份替换这个文件的当前内容，并保留新的恢复记录。文件版本不匹配时会拒绝恢复，请先核对当前内容。"
                a.addButton(withTitle:"恢复文件");a.addButton(withTitle:"取消");a.buttons[0].keyEquivalent="";a.buttons[1].keyEquivalent="\r"
                a.beginSheetModal(for:self.window){[weak self]r in
                    guard let self=self,r == .alertFirstButtonReturn else{return}
                    self.api("restore",data:["id":id,"changeId":changeID]){[weak self]_,error in
                        guard let self=self else{return};if let error=error{self.toast(error,error:true);return}
                        self.toast("文件已恢复，并保留恢复记录。");self.send(["type":"restored","id":id])
                    }
                }
            }
        }
    }
    func exportFolder(_ id:String){
        api("export",data:["id":id]){[weak self]out,error in
            guard let self=self else{return};if let error=error{self.toast(error,error:true);return}
            guard let text=out?["text"] as? String else{return}
            let panel=NSSavePanel();panel.nameFieldStringValue=out?["name"] as? String ?? "项目资料.md";panel.title="导出项目资料";panel.prompt="保存"
            panel.beginSheetModal(for:self.window){r in if r == .OK,let u=panel.url{do{try text.write(to:u,atomically:true,encoding:.utf8);self.toast("资料已导出，可以上传到 ChatGPT。")}catch{self.toast("导出失败："+error.localizedDescription,error:true)}}}
        }
    }
    func configureTunnel(){
        let a=NSAlert();a.messageText="配置 ChatGPT 连接";a.informativeText="使用 OpenAI 平台的 Tunnel ID 和运行密钥。\n密钥仅用于连接通道，本应用不会调用模型 API。";a.addButton(withTitle:"保存设置");a.addButton(withTitle:"取消")
        let view=NSView(frame:NSRect(x:0,y:0,width:390,height:285))
        func label(_ s:String,_ y:CGFloat){let l=NSTextField(labelWithString:s);l.frame=NSRect(x:0,y:y,width:390,height:18);l.font=NSFont.systemFont(ofSize:11);l.textColor = .secondaryLabelColor;view.addSubview(l)}
        label("Tunnel ID",260);let id=NSTextField(string:tunnelID);id.frame=NSRect(x:0,y:228,width:390,height:27);id.placeholderString="tunnel_…";view.addSubview(id)
        label("运行密钥（已保存时，留空可继续使用）",202);let key=NSSecureTextField();key.frame=NSRect(x:0,y:169,width:390,height:27);key.placeholderString="sk-…";view.addSubview(key)
        let remember=NSButton(checkboxWithTitle:"将运行密钥保存在 Mac 钥匙串",target:nil,action:nil);remember.state=rememberKey ? .on:.off;remember.frame=NSRect(x:0,y:137,width:390,height:24);view.addSubview(remember)
        label("组织 ID（可选）",111);let org=NSTextField(string:organization);org.frame=NSRect(x:0,y:79,width:390,height:27);org.placeholderString="org-…";view.addSubview(org)
        label("HTTPS 代理地址（可选）",53);let proxyField=NSTextField(string:proxy);proxyField.frame=NSRect(x:0,y:20,width:390,height:27);proxyField.placeholderString="例如 http://127.0.0.1:7897";view.addSubview(proxyField)
        a.accessoryView=view
        a.beginSheetModal(for:window){[weak self]r in
            guard let self=self,r == .alertFirstButtonReturn else{return}
            let newID=id.stringValue.trimmingCharacters(in:.whitespacesAndNewlines),newKey=key.stringValue.trimmingCharacters(in:.whitespacesAndNewlines),newProxy=proxyField.stringValue.trimmingCharacters(in:.whitespacesAndNewlines)
            guard newID.range(of:"^tunnel_[A-Za-z0-9_-]{8,128}$",options:.regularExpression) != nil else{self.toast("Tunnel ID 格式不正确。",error:true);return}
            if !newProxy.isEmpty{guard let u=URL(string:newProxy),["http","https"].contains(u.scheme ?? ""),u.host != nil,u.user == nil,u.password == nil else{self.toast("代理地址需要是 http / https 地址，且不含账号密码。",error:true);return}}
            let usableKey = !newKey.isEmpty ? newKey:(!self.runtimeKey.isEmpty ? self.runtimeKey:(self.keychainKey() ?? ""))
            guard usableKey.hasPrefix("sk-"),usableKey.count>16 else{self.toast("请输入有效的运行密钥。",error:true);return}
            self.stopTunnel();self.runtimeKey=usableKey;self.tunnelID=newID;self.organization=org.stringValue.trimmingCharacters(in:.whitespacesAndNewlines);self.proxy=newProxy;self.rememberKey=remember.state == .on
            if self.rememberKey{if !self.saveKey(usableKey){self.rememberKey=false;self.toast("钥匙串保存失败，密钥仅在本次运行中保留。",error:true)}}else{self.deleteKey()}
            let c:[String:Any]=["tunnelId":self.tunnelID,"organization":self.organization,"proxy":self.proxy,"rememberKey":self.rememberKey]
            do{let d=try JSONSerialization.data(withJSONObject:c,options:.prettyPrinted);try d.write(to:self.connectionFile,options:.atomic);try FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:self.connectionFile.path)}catch{self.toast("设置保存失败："+error.localizedDescription,error:true);return}
            self.tunnelState="configured";self.detail="连接信息已保存。点击启动连接后，在 ChatGPT 中选择此 Tunnel。";self.connectionStatus()
        }
    }
    func stopTunnel(){if let p=tunnel,p.isRunning{p.terminate()};tunnel=nil;healthURL=nil;healthCheckRunning=false}
    func startTunnel(){
        if tunnel?.isRunning == true{return}
        guard port>0,!tunnelID.isEmpty else{toast("请先完成连接配置。",error:true);return}
        let key = !runtimeKey.isEmpty ? runtimeKey:(keychainKey() ?? "")
        guard !key.isEmpty else{configureTunnel();return}
        runtimeKey=key;try? FileManager.default.removeItem(at:healthFile)
        let p=Process();p.executableURL=resources.appendingPathComponent("bin/tunnel-client")
        p.arguments=["run","--control-plane.tunnel-id",tunnelID,"--control-plane.api-key","env:CONTROL_PLANE_API_KEY","--mcp.server-url","url=http://127.0.0.1:\(port)/mcp,channel=main","--mcp.extra-headers","Authorization: env:LOCALREADER_MCP_AUTH","--health.listen-addr","127.0.0.1:0","--health.url-file",healthFile.path,"--log.format","json"]
        var env=runtimeEnvironment()
        env["CONTROL_PLANE_API_KEY"]=key;env["LOCALREADER_MCP_AUTH"]="Bearer "+mcpToken;env.removeValue(forKey:"OPENAI_API_KEY");env.removeValue(forKey:"OPENAI_ADMIN_KEY")
        if !organization.isEmpty{env["CONTROL_PLANE_ORGANIZATION_ID"]=organization}else{env.removeValue(forKey:"CONTROL_PLANE_ORGANIZATION_ID")}
        if !proxy.isEmpty{p.arguments! += ["--control-plane.http-proxy",proxy]}
        p.environment=env;p.currentDirectoryURL=appSupport
        let out=Pipe();tunnelPipe=out;p.standardOutput=out;p.standardError=out
        out.fileHandleForReading.readabilityHandler={[weak self]h in let d=h.availableData;guard !d.isEmpty,let s=String(data:d,encoding:.utf8) else{return};DispatchQueue.main.async{self?.consumeTunnelOutput(s)}}
        p.terminationHandler={[weak self]ended in DispatchQueue.main.async{guard let self=self,self.tunnel===ended else{return};self.tunnel=nil;self.healthURL=nil;self.tunnelState="error";self.detail=self.lastTunnelError.isEmpty ? "连接程序已停止，请检查运行密钥、Tunnel 权限和网络。":self.lastTunnelError;self.connectionStatus()}}
        do{tunnel=p;lastTunnelError="";tunnelOutput="";try p.run();tunnelState="starting";detail="正在等待官方连接客户端就绪…";connectionStatus()}catch{tunnel=nil;tunnelState="error";detail="连接客户端无法启动："+error.localizedDescription;connectionStatus()}
    }
    func consumeTunnelOutput(_ text:String){
        var s=text.replacingOccurrences(of:runtimeKey,with:"[已隐藏]").replacingOccurrences(of:mcpToken,with:"[已隐藏]")
        s=s.replacingOccurrences(of:"sk-[A-Za-z0-9_-]+",with:"[已隐藏]",options:.regularExpression)
        tunnelOutput+=s
        if tunnelOutput.count>20000{tunnelOutput=String(tunnelOutput.suffix(20000))}
        for line in s.split(separator:"\n"){
            if let d=String(line).data(using:.utf8),let obj=try? JSONSerialization.jsonObject(with:d) as? [String:Any],let level=obj["level"] as? String,["error","fatal"].contains(level.lowercased()){
                lastTunnelError=String((obj["msg"] as? String ?? obj["message"] as? String ?? "连接失败，请查看连接诊断。").prefix(250))
            }
        }
    }
    func checkHealth(){
        guard let p=tunnel,p.isRunning,!healthCheckRunning else{return}
        if healthURL==nil,let s=try? String(contentsOf:healthFile,encoding:.utf8),let u=URL(string:s.trimmingCharacters(in:.whitespacesAndNewlines)),u.scheme=="http",u.host=="127.0.0.1"{healthURL=u}
        guard let base=healthURL else{return};healthCheckRunning=true
        var req=URLRequest(url:base.appendingPathComponent("readyz"));req.timeoutInterval=2
        URLSession.shared.dataTask(with:req){[weak self]d,res,e in DispatchQueue.main.async{
            guard let self=self,self.tunnel===p else{return}
            let clientReady=e==nil && (res as? HTTPURLResponse)?.statusCode==200
            var metricsRequest=URLRequest(url:base.appendingPathComponent("metrics"));metricsRequest.timeoutInterval=2
            URLSession.shared.dataTask(with:metricsRequest){data,response,error in DispatchQueue.main.async{
                guard self.tunnel===p else{return};self.healthCheckRunning=false
                let metrics=error==nil && (response as? HTTPURLResponse)?.statusCode==200 ? data.flatMap{String(data:$0,encoding:.utf8)}:nil
                let status=tunnelConnectionAssessment(ready:clientReady,metrics:metrics)
                self.tunnelState=status.state;self.detail=status.detail;self.connectionStatus()
            }}.resume()
        }}.resume()
    }
}

@main struct LocalReaderMain {
    static func main(){
        let args=CommandLine.arguments
        if args.count==3,args[1]=="--extract-pdf"{extractPDF(args[2]);return}
        let app=NSApplication.shared;let delegate=AppDelegate();app.delegate=delegate;app.setActivationPolicy(.regular);app.run();withExtendedLifetime(delegate){}
    }
}

import AppKit
import WebKit

// A local design viewer. This executable has no Blabee service or Codex integration.
final class AirPreviewPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

final class AirPreviewController: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    let panel: NSPanel
    let material = NSVisualEffectView()
    let resource: URL
    var web: WKWebView!
    var theme = "light"
    var appearanceMaterial = "air"
    var radius: CGFloat = 38

    init(resource: URL) {
        self.resource = resource.standardizedFileURL
        panel = AirPreviewPanel(contentRect: NSRect(x: 0, y: 0, width: 460, height: 680),
                        styleMask: [.borderless], backing: .buffered, defer: false)
        super.init()
        panel.title = "Blabee Air Demo · 독립 UI 데모"
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.isMovableByWindowBackground = true
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        material.material = .hudWindow
        material.blendingMode = .behindWindow
        material.state = .active
        material.wantsLayer = true
        material.layer?.cornerRadius = radius
        material.layer?.masksToBounds = true
        panel.contentView = material
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.userContentController.add(self, name: "previewSize")
        let maxHeight = max(240, Int((NSScreen.main?.visibleFrame.height ?? 850) - 60))
        let bootstrap = """
        window.nativeQuery = 'screen=12&theme=light';
        document.addEventListener('DOMContentLoaded', () => {
          document.body.classList.add('native');
          document.documentElement.style.setProperty('--native-max-height', '\(maxHeight)px');
        });
        """
        config.userContentController.addUserScript(WKUserScript(source: bootstrap, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        web = WKWebView(frame: material.bounds, configuration: config)
        web.setValue(false, forKey: "drawsBackground")
        web.underPageBackgroundColor = .clear
        web.autoresizingMask = [.width, .height]
        web.navigationDelegate = self
        material.addSubview(web)
        panel.appearance = NSAppearance(named: .aqua)
        panel.center()
        web.loadFileURL(resource.appendingPathComponent("index.html"), allowingReadAccessTo: resource)
    }

    func show() {
        panel.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func navigate(_ id: String) {
        call("navigate", argument: id)
        show()
    }

    func updateAppearance() {
        panel.appearance = NSAppearance(named: theme == "dark" ? .darkAqua : .aqua)
        material.layer?.cornerRadius = radius
        call("setAppearance", argument: ["theme": theme, "material": appearanceMaterial, "radius": radius == 38 ? "38" : "20.2"])
    }

    func result(_ state: String) { call("setResult", argument: state) }

    private func call(_ method: String, argument: Any) {
        // Methods are fixed local literals; data is JSON encoded, never executable input.
        guard ["navigate", "setAppearance", "setResult"].contains(method),
              let bytes = try? JSONSerialization.data(withJSONObject: [argument], options: [.fragmentsAllowed]),
              let json = String(data: bytes, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.AirDemo?.\(method)(...\(json))", completionHandler: nil)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "previewSize", message.frameInfo.isMainFrame,
              let payload = message.body as? [String: NSNumber],
              let width = payload["width"]?.doubleValue, let height = payload["height"]?.doubleValue,
              width.isFinite, height.isFinite, width > 0, height > 0 else { return }
        let screen = (panel.screen ?? NSScreen.main)?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let w = min(460, screen.width - 24)
        let h = min(max(CGFloat(height), 180), screen.height - 32)
        let previous = panel.frame
        let x = min(max(previous.minX, screen.minX + 12), screen.maxX - w - 12)
        let y = min(max(previous.maxY - h, screen.minY + 16), screen.maxY - h - 16)
        guard abs(previous.width - w) > 0.5 || abs(previous.height - h) > 0.5 else { return }
        panel.setFrame(NSRect(x: x, y: y, width: w, height: h), display: true)
        panel.invalidateShadow()
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url, url.isFileURL,
              url.standardizedFileURL.path.hasPrefix(resource.path + "/") else {
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }
}

final class AirPreviewDelegate: NSObject, NSApplicationDelegate {
    var controller: AirPreviewController!

    func applicationDidFinishLaunching(_ notification: Notification) {
        let main = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu(title: "Blabee Air Demo")
        let caption = NSMenuItem(title: "독립 UI 데모 · 실제 실행 없음", action: nil, keyEquivalent: "")
        caption.isEnabled = false
        appMenu.addItem(caption)
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "데모 종료", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        main.addItem(appItem)
        let screenMenu = NSMenu(title: "화면")
        for (title, id) in [("준비됨", "08"), ("선택지 2개", "09"), ("선택지 4개", "12"), ("긴 문장", "13"), ("대기 작업 3개", "14"), ("상세 미리보기", "H1"), ("승인 요청", "24"), ("연결 오류", "19"), ("설정", "02"), ("업데이트", "U1")] {
            add(title, value: id, selector: #selector(screen(_:)), to: screenMenu)
        }
        let screenItem = NSMenuItem(title: "화면", action: nil, keyEquivalent: "")
        screenItem.submenu = screenMenu
        main.addItem(screenItem)
        let style = NSMenu(title: "표현")
        for (title, value) in [("밝은 유리", "light"), ("어두운 유리", "dark")] { add(title, value: value, selector: #selector(theme(_:)), to: style) }
        style.addItem(.separator())
        for (title, value) in [("Air · 옅은 빛", "air"), ("중성 유리", "neutral"), ("불투명", "solid")] { add(title, value: value, selector: #selector(material(_:)), to: style) }
        style.addItem(.separator())
        for (title, value) in [("곡률 38 · 시안", "38"), ("곡률 20.2 · 현재", "20.2")] { add(title, value: value, selector: #selector(radius(_:)), to: style) }
        let styleItem = NSMenuItem(title: "표현", action: nil, keyEquivalent: "")
        styleItem.submenu = style
        main.addItem(styleItem)
        let results = NSMenu(title: "결과 예시")
        for (title, value) in [("전달 요청 접수", "accepted"), ("전달 결과 불명확", "uncertain"), ("승인 응답 접수", "permission-result"), ("업데이트 설치 검토", "update-ready"), ("업데이트 검증 실패", "update-failure"), ("세션 복원 결과", "update-restored")] {
            add(title, value: value, selector: #selector(result(_:)), to: results)
        }
        let resultItem = NSMenuItem(title: "결과 예시", action: nil, keyEquivalent: "")
        resultItem.submenu = results
        main.addItem(resultItem)
        NSApp.mainMenu = main
        controller = AirPreviewController(resource: Bundle.main.resourceURL!.appendingPathComponent("ui"))
        controller.show()
    }

    private func add(_ title: String, value: String, selector: Selector, to menu: NSMenu) {
        let item = NSMenuItem(title: title, action: selector, keyEquivalent: "")
        item.target = self
        item.representedObject = value
        menu.addItem(item)
    }
    @objc func screen(_ item: NSMenuItem) { controller.navigate(item.representedObject as! String) }
    @objc func theme(_ item: NSMenuItem) { controller.theme = item.representedObject as! String; controller.updateAppearance() }
    @objc func material(_ item: NSMenuItem) { controller.appearanceMaterial = item.representedObject as! String; controller.updateAppearance() }
    @objc func radius(_ item: NSMenuItem) { controller.radius = CGFloat(Double(item.representedObject as! String) ?? 38); controller.updateAppearance() }
    @objc func result(_ item: NSMenuItem) { controller.result(item.representedObject as! String) }
}

let application = NSApplication.shared
let delegate = AirPreviewDelegate()
application.setActivationPolicy(.regular)
application.delegate = delegate
application.run()

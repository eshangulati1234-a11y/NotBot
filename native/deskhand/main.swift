// deskhand: the part of Notbot that looks at and acts on a Mac's screen.
//
// It speaks one JSON object per line on stdin and answers one per line on stdout:
//   {"id":1,"cmd":"tree","args":{"depth":8}}  ->  {"id":1,"ok":true,"result":{...}}
// Every safety rule that matters is enforced here, not only in the caller: blocked apps,
// the optional allowed-apps list, and a refusal to ever type into a password field.

import AppKit
import ApplicationServices
import Foundation

// MARK: - Policy

/// Apps that can hold passwords or control the Mac itself. Never looked at, never driven.
let alwaysBlocked: [String] = [
    "com.apple.keychainaccess", "com.apple.passwords", "com.apple.systempreferences",
    "com.apple.terminal", "com.googlecode.iterm2", "com.1password.", "com.agilebits.onepassword",
    "com.bitwarden.", "org.keepassxc.", "com.lastpass.", "com.dashlane.", "dev.warp.",
    // Names, for apps that are not running yet (open_app) and as a second check.
    "terminal", "iterm", "iterm2", "keychain access", "passwords", "system settings", "system preferences",
    "1password", "bitwarden", "keepassxc", "lastpass", "dashlane", "warp",
]

struct Policy {
    var allow: [String] = []   // when not empty, only these apps (bundle id prefix or name)
    var block: [String] = []   // extra blocks from the user
}
var policy = Policy()

func permitted(_ app: NSRunningApplication) -> String? {
    let bundle = (app.bundleIdentifier ?? "").lowercased()
    let name = (app.localizedName ?? "").lowercased()
    if bundle == Bundle.main.bundleIdentifier?.lowercased() { return "Notbot never drives itself." }
    for blocked in alwaysBlocked + policy.block.map({ $0.lowercased() }) {
        if bundle.hasPrefix(blocked) || name == blocked || name.hasPrefix(blocked + " ") {
            return "\(app.localizedName ?? bundle) is on the blocked list."
        }
    }
    if !policy.allow.isEmpty {
        let ok = policy.allow.contains { rule in
            let r = rule.lowercased()
            return bundle.hasPrefix(r) || name == r
        }
        if !ok { return "\(app.localizedName ?? bundle) is not in the list of apps this helper may use." }
    }
    return nil
}

struct Failure: Error { let message: String }

// MARK: - Accessibility helpers

func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}

func text(_ element: AXUIElement, _ name: String) -> String? {
    guard let value = attribute(element, name) else { return nil }
    if let string = value as? String { return string }
    if let number = value as? NSNumber { return number.stringValue }
    return nil
}

func firstText(_ element: AXUIElement) -> String? {
    let names: [String] = [kAXTitleAttribute as String, kAXDescriptionAttribute as String,
                           kAXPlaceholderValueAttribute as String, kAXHelpAttribute as String]
    for name in names {
        if let value = text(element, name), !value.isEmpty { return value }
    }
    return nil
}

func rect(_ element: AXUIElement) -> CGRect? {
    guard let p = attribute(element, kAXPositionAttribute as String),
          let s = attribute(element, kAXSizeAttribute as String),
          CFGetTypeID(p) == AXValueGetTypeID(), CFGetTypeID(s) == AXValueGetTypeID()
    else { return nil }
    var point = CGPoint.zero
    var size = CGSize.zero
    AXValueGetValue(p as! AXValue, .cgPoint, &point)
    AXValueGetValue(s as! AXValue, .cgSize, &size)
    return CGRect(origin: point, size: size)
}

func children(_ element: AXUIElement) -> [AXUIElement] {
    (attribute(element, kAXChildrenAttribute as String) as? [AXUIElement]) ?? []
}

func actionNames(_ element: AXUIElement) -> [String] {
    var names: CFArray?
    guard AXUIElementCopyActionNames(element, &names) == .success, let list = names as? [String] else { return [] }
    return list.map { $0.replacingOccurrences(of: "AX", with: "").lowercased() }
}

func isSecure(_ element: AXUIElement) -> Bool {
    text(element, kAXSubroleAttribute as String) == "AXSecureTextField"
}

func targetApp(_ name: String?) throws -> NSRunningApplication {
    let apps = NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular }
    let found: NSRunningApplication?
    if let name, !name.isEmpty {
        let needle = name.lowercased()
        found = apps.first { ($0.localizedName ?? "").lowercased() == needle }
            ?? apps.first { ($0.bundleIdentifier ?? "").lowercased() == needle }
            ?? apps.first { ($0.localizedName ?? "").lowercased().contains(needle) }
    } else {
        found = NSWorkspace.shared.frontmostApplication.flatMap { $0.activationPolicy == .regular ? $0 : nil }
            ?? apps.first { $0.isActive }
    }
    guard let app = found else { throw Failure(message: name.map { "\($0) is not running." } ?? "No app is in front.") }
    if let reason = permitted(app) { throw Failure(message: reason) }
    return app
}

// MARK: - Tree

/// Roles worth showing a model. Everything else is skipped but still searched for children.
let interesting: Set<String> = [
    "AXButton", "AXTextField", "AXTextArea", "AXCheckBox", "AXRadioButton", "AXPopUpButton",
    "AXMenuButton", "AXMenuItem", "AXMenuBarItem", "AXLink", "AXSlider", "AXComboBox", "AXTab",
    "AXDisclosureTriangle", "AXIncrementor", "AXSwitch", "AXSearchField",
]

var registry: [String: AXUIElement] = [:]
var registryFrames: [String: CGRect] = [:]
var snapshotApp: String = ""

func buildTree(app: NSRunningApplication, depth: Int, maxNodes: Int) -> [String: Any] {
    registry = [:]
    registryFrames = [:]
    snapshotApp = app.bundleIdentifier ?? app.localizedName ?? ""
    let root = AXUIElementCreateApplication(app.processIdentifier)
    AXUIElementSetMessagingTimeout(root, 2.0)
    var nodes: [[String: Any]] = []
    var truncated = false

    func add(_ element: AXUIElement, role: String, parent: String?) -> String? {
        if nodes.count >= maxNodes { truncated = true; return nil }
        let id = "e\(nodes.count + 1)"
        let label = firstText(element)
        var node: [String: Any] = ["id": id, "role": role.replacingOccurrences(of: "AX", with: "")]
        if let label { node["label"] = String(label.prefix(120)) }
        if isSecure(element) {
            node["secure"] = true
        } else if let value = text(element, kAXValueAttribute as String), !value.isEmpty {
            node["value"] = String(value.prefix(160))
        }
        node["enabled"] = (attribute(element, kAXEnabledAttribute as String) as? Bool) ?? true
        if (attribute(element, kAXFocusedAttribute as String) as? Bool) == true { node["focused"] = true }
        if let frame = rect(element) {
            node["frame"] = [Int(frame.minX), Int(frame.minY), Int(frame.width), Int(frame.height)]
            registryFrames[id] = frame
        }
        let actions = actionNames(element)
        if !actions.isEmpty { node["actions"] = actions }
        if let parent { node["parent"] = parent }
        registry[id] = element
        nodes.append(node)
        return id
    }

    func walk(_ element: AXUIElement, level: Int, parent: String?) {
        if level > depth || nodes.count >= maxNodes { return }
        let role = text(element, kAXRoleAttribute as String) ?? ""
        var next = parent
        if interesting.contains(role) {
            next = add(element, role: role, parent: parent) ?? parent
        } else if role == "AXStaticText" {
            if let value = text(element, kAXValueAttribute as String), !value.isEmpty {
                _ = add(element, role: role, parent: parent)
            }
        }
        for child in children(element) { walk(child, level: level + 1, parent: next) }
    }

    var windowTitle = ""
    if let window = attribute(root, kAXFocusedWindowAttribute as String) {
        let win = window as! AXUIElement
        windowTitle = text(win, kAXTitleAttribute as String) ?? ""
        let id = add(win, role: "AXWindow", parent: nil)
        walk(win, level: 0, parent: id)
    }
    if let bar = attribute(root, kAXMenuBarAttribute as String) {
        for item in children(bar as! AXUIElement) where text(item, kAXRoleAttribute as String) == "AXMenuBarItem" {
            _ = add(item, role: "AXMenuBarItem", parent: nil)
        }
    }
    return [
        "app": app.localizedName ?? "", "bundle": app.bundleIdentifier ?? "", "pid": Int(app.processIdentifier),
        "window": windowTitle, "nodes": nodes, "truncated": truncated,
    ]
}

// MARK: - Input

func post(_ event: CGEvent?) { event?.post(tap: .cghidEventTap) }

func clickAt(_ point: CGPoint, button: CGMouseButton = .left, count: Int = 1) {
    let down: CGEventType = button == .left ? .leftMouseDown : .rightMouseDown
    let up: CGEventType = button == .left ? .leftMouseUp : .rightMouseUp
    post(CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: button))
    usleep(40_000)
    for n in 1...max(1, count) {
        let d = CGEvent(mouseEventSource: nil, mouseType: down, mouseCursorPosition: point, mouseButton: button)
        d?.setIntegerValueField(.mouseEventClickState, value: Int64(n))
        post(d)
        let u = CGEvent(mouseEventSource: nil, mouseType: up, mouseCursorPosition: point, mouseButton: button)
        u?.setIntegerValueField(.mouseEventClickState, value: Int64(n))
        post(u)
        usleep(60_000)
    }
}

func focusedElement() -> AXUIElement? {
    let system = AXUIElementCreateSystemWide()
    guard let value = attribute(system, kAXFocusedUIElementAttribute as String) else { return nil }
    return (value as! AXUIElement)
}

func typeText(_ string: String) throws {
    if let focused = focusedElement(), isSecure(focused) {
        throw Failure(message: "A password field is focused. Notbot never types into password fields.")
    }
    for chunk in string.chunked(by: 20) {
        let units = Array(chunk.utf16)
        for keyDown in [true, false] {
            let event = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: keyDown)
            event?.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
            post(event)
        }
        usleep(15_000)
    }
}

extension String {
    func chunked(by size: Int) -> [String] {
        var result: [String] = []
        var current = ""
        for character in self {
            current.append(character)
            if current.count >= size { result.append(current); current = "" }
        }
        if !current.isEmpty { result.append(current) }
        return result
    }
}

let keyCodes: [String: CGKeyCode] = [
    "return": 36, "enter": 36, "tab": 48, "space": 49, "delete": 51, "backspace": 51, "escape": 53, "esc": 53,
    "left": 123, "right": 124, "down": 125, "up": 126, "home": 115, "end": 119, "pageup": 116, "pagedown": 121,
    "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12, "w": 13,
    "e": 14, "r": 15, "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "9": 25, "7": 26,
    "8": 28, "0": 29, "o": 31, "u": 32, "i": 34, "p": 35, "l": 37, "j": 38, "k": 40, "n": 45, "m": 46,
    "f1": 122, "f2": 120, "f3": 99, "f4": 118, "f5": 96,
]

func press(_ combo: String) throws {
    let parts = combo.lowercased().split(separator: "+").map(String.init)
    guard let last = parts.last, let code = keyCodes[last] else { throw Failure(message: "Unknown key: \(combo)") }
    var flags: CGEventFlags = []
    for modifier in parts.dropLast() {
        switch modifier {
        case "cmd", "command": flags.insert(.maskCommand)
        case "shift": flags.insert(.maskShift)
        case "opt", "option", "alt": flags.insert(.maskAlternate)
        case "ctrl", "control": flags.insert(.maskControl)
        default: throw Failure(message: "Unknown modifier: \(modifier)")
        }
    }
    if let focused = focusedElement(), isSecure(focused), last.count == 1, flags.isEmpty {
        throw Failure(message: "A password field is focused. Notbot never types into password fields.")
    }
    for keyDown in [true, false] {
        let event = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: keyDown)
        event?.flags = flags
        post(event)
    }
}

// MARK: - Screenshot

func screenshot(app: NSRunningApplication, maxPx: Int) throws -> [String: Any] {
    let root = AXUIElementCreateApplication(app.processIdentifier)
    var region: CGRect?
    if let window = attribute(root, kAXFocusedWindowAttribute as String) {
        region = rect(window as! AXUIElement)
    }
    let directory = NSTemporaryDirectory() + "notbot-deskhand-\(getpid())"
    try? FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
    let raw = directory + "/shot.png"
    let small = directory + "/shot.jpg"
    defer { try? FileManager.default.removeItem(atPath: directory) }
    var args = ["-x", "-t", "png"]
    if let region { args += ["-R", "\(Int(region.minX)),\(Int(region.minY)),\(Int(region.width)),\(Int(region.height))"] }
    args.append(raw)
    try run("/usr/sbin/screencapture", args)
    guard FileManager.default.fileExists(atPath: raw) else {
        throw Failure(message: "Screen Recording permission is needed to take screenshots.")
    }
    try run("/usr/bin/sips", ["-Z", String(maxPx), "-s", "format", "jpeg", "-s", "formatOptions", "55", raw, "--out", small])
    guard let data = FileManager.default.contents(atPath: small) else { throw Failure(message: "Screenshot failed.") }
    return ["mime": "image/jpeg", "base64": data.base64EncodedString(), "bytes": data.count]
}

func run(_ path: String, _ args: [String]) throws {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: path)
    process.arguments = args
    process.standardOutput = FileHandle.nullDevice
    process.standardError = FileHandle.nullDevice
    try process.run()
    process.waitUntilExit()
    if process.terminationStatus != 0 { throw Failure(message: "\(path) failed.") }
}

// MARK: - Commands

func requireAccessibility() throws {
    if !AXIsProcessTrusted() {
        throw Failure(message: "Accessibility permission is needed. Turn it on in System Settings > Privacy & Security > Accessibility.")
    }
}

func handle(_ command: String, _ args: [String: Any]) throws -> Any {
    switch command {
    case "status":
        return ["accessibility": AXIsProcessTrusted(), "screen": CGPreflightScreenCaptureAccess(), "pid": Int(getpid())]
    case "policy":
        policy.allow = (args["allow"] as? [String]) ?? []
        policy.block = (args["block"] as? [String]) ?? []
        return ["allow": policy.allow, "block": policy.block]
    case "apps":
        let front = NSWorkspace.shared.frontmostApplication?.processIdentifier
        return NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular }.map {
            ["name": $0.localizedName ?? "", "bundle": $0.bundleIdentifier ?? "", "pid": Int($0.processIdentifier),
             "frontmost": $0.processIdentifier == front, "allowed": permitted($0) == nil] as [String: Any]
        }
    case "tree":
        try requireAccessibility()
        let app = try targetApp(args["app"] as? String)
        return buildTree(app: app, depth: min((args["depth"] as? Int) ?? 12, 20), maxNodes: min((args["max_nodes"] as? Int) ?? 200, 400))
    case "screenshot":
        let app = try targetApp(args["app"] as? String)
        return try screenshot(app: app, maxPx: min((args["max_px"] as? Int) ?? 1280, 2000))
    case "focus_app":
        let app = try targetApp(args["app"] as? String)
        app.activate()
        return ["focused": app.localizedName ?? ""]
    case "open_app":
        guard let name = args["app"] as? String, !name.isEmpty else { throw Failure(message: "Say which app to open.") }
        let lowered = name.lowercased()
        for blocked in alwaysBlocked + policy.block.map({ $0.lowercased() }) where lowered.hasPrefix(blocked) || lowered == blocked {
            throw Failure(message: "\(name) is on the blocked list.")
        }
        if !policy.allow.isEmpty && !policy.allow.contains(where: { $0.lowercased() == lowered }) {
            throw Failure(message: "\(name) is not in the list of apps this helper may use.")
        }
        try run("/usr/bin/open", ["-a", name])
        return ["opened": name]
    case "click":
        try requireAccessibility()
        let front = try targetApp(args["app"] as? String)
        let button: CGMouseButton = (args["button"] as? String) == "right" ? .right : .left
        let count = (args["count"] as? Int) ?? 1
        if let id = args["id"] as? String {
            guard let element = registry[id], snapshotApp == (front.bundleIdentifier ?? front.localizedName ?? "") else {
                throw Failure(message: "That element is from an older look. Look again first.")
            }
            if let secure = Optional(isSecure(element)), secure { throw Failure(message: "Notbot does not click inside password fields.") }
            if button == .left && count == 1 && actionNames(element).contains("press"),
               AXUIElementPerformAction(element, kAXPressAction as CFString) == .success {
                return ["clicked": id, "how": "press"]
            }
            guard let frame = registryFrames[id], frame.width > 0 else { throw Failure(message: "That element has no position on screen.") }
            clickAt(CGPoint(x: frame.midX, y: frame.midY), button: button, count: count)
            return ["clicked": id, "how": "pointer"]
        }
        guard let x = args["x"] as? Double, let y = args["y"] as? Double else { throw Failure(message: "Say which element to click.") }
        clickAt(CGPoint(x: x, y: y), button: button, count: count)
        return ["clicked": [x, y], "how": "pointer"]
    case "type":
        try requireAccessibility()
        _ = try targetApp(nil)
        guard let string = args["text"] as? String, string.count <= 2000 else { throw Failure(message: "Give text of at most 2000 characters.") }
        try typeText(string)
        return ["typed": string.count]
    case "key":
        try requireAccessibility()
        _ = try targetApp(nil)
        guard let combo = args["combo"] as? String else { throw Failure(message: "Say which key.") }
        try press(combo)
        return ["pressed": combo]
    case "scroll":
        try requireAccessibility()
        _ = try targetApp(nil)
        let dy = (args["dy"] as? Int) ?? 0
        let dx = (args["dx"] as? Int) ?? 0
        post(CGEvent(scrollWheelEvent2Source: nil, units: .line, wheelCount: 2, wheel1: Int32(-dy), wheel2: Int32(-dx), wheel3: 0))
        return ["scrolled": [dx, dy]]
    default:
        throw Failure(message: "Unknown command: \(command)")
    }
}

// MARK: - Loop

func reply(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object),
          let line = String(data: data, encoding: .utf8) else { return }
    print(line)
    fflush(stdout)
}

setvbuf(stdout, nil, _IOLBF, 0)
while let line = readLine() {
    guard let data = line.data(using: .utf8),
          let request = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let command = request["cmd"] as? String else {
        reply(["ok": false, "error": "Bad request."])
        continue
    }
    let id = request["id"] ?? NSNull()
    do {
        let result = try handle(command, (request["args"] as? [String: Any]) ?? [:])
        reply(["id": id, "ok": true, "result": result])
    } catch let failure as Failure {
        reply(["id": id, "ok": false, "error": failure.message])
    } catch {
        reply(["id": id, "ok": false, "error": "\(error)"])
    }
}

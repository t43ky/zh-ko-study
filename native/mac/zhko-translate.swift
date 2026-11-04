// 중한 공부 번역기 - macOS 애플 번역 도우미
// Apple Translation 프레임워크(기기 안에서 동작, 무료)로 중국어(간체) → 한국어 번역.
// 표준 입력으로 한 줄에 하나씩 {"id": 1, "text": "..."} 를 받고,
// 표준 출력으로 {"id": 1, "text": "..."} 또는 {"id": 1, "error": "...", "code": "..."} 를 돌려준다.
// 시작하자마자 상태 한 줄 {"ready": true} 또는 {"ready": false, "code": "...", "error": "..."} 을 먼저 보낸다.
// 앱 없이 직접 세션을 만드는 API(TranslationSession(installedSource:target:))는 macOS 26 부터 지원.
//
// --selected-text 로 실행하면 번역 대신, 지금 맨 앞 앱에서 선택된 글자를 손쉬운 사용(Accessibility) API 로
// 직접 읽어서 {"text": "..."} 또는 {"error": "...", "code": "..."} 한 줄을 출력하고 끝난다.
// (⌘C 를 보내지 않으므로 클립보드를 건드리지 않고, 다른 단축키와 겹치지도 않는다)

import Foundation
import AppKit
import ApplicationServices
import Translation

// MARK: - 선택된 글 읽기 (손쉬운 사용)

func axValue(_ el: AXUIElement, _ attr: String) -> CFTypeRef? {
    var v: CFTypeRef?
    return AXUIElementCopyAttributeValue(el, attr as CFString, &v) == .success ? v : nil
}

// 일반 앱: AXSelectedText / 사파리 등 WebKit: AXSelectedTextMarkerRange → AXStringForTextMarkerRange
func selectedText(of el: AXUIElement) -> String? {
    if let s = axValue(el, kAXSelectedTextAttribute) as? String, !s.isEmpty { return s }
    if let range = axValue(el, "AXSelectedTextMarkerRange") {
        var out: CFTypeRef?
        if AXUIElementCopyParameterizedAttributeValue(el, "AXStringForTextMarkerRange" as CFString, range, &out) == .success,
           let s = out as? String, !s.isEmpty {
            return s
        }
    }
    return nil
}

func readSelectedText() -> [String: Any] {
    guard AXIsProcessTrusted() else {
        return ["error": "손쉬운 사용 권한이 없습니다", "code": "access"]
    }
    guard let front = NSWorkspace.shared.frontmostApplication else {
        return ["error": "맨 앞 앱을 찾지 못했습니다", "code": "none"]
    }
    let appEl = AXUIElementCreateApplication(front.processIdentifier)
    // 크롬·Electron 앱은 손쉬운 사용 정보를 기본으로 꺼 두므로 켜 달라고 요청
    _ = AXUIElementSetAttributeValue(appEl, "AXManualAccessibility" as CFString, true as CFTypeRef)

    var start: AXUIElement? = nil
    if let f = axValue(appEl, kAXFocusedUIElementAttribute) {
        start = (f as! AXUIElement)
    } else if let f = axValue(AXUIElementCreateSystemWide(), kAXFocusedUIElementAttribute) {
        start = (f as! AXUIElement)
    }
    // 초점이 있는 요소에서 시작해 부모 쪽으로 몇 단계 올라가며 찾는다 (웹 페이지는 상위 영역이 선택을 가짐)
    var el = start
    var depth = 0
    while let cur = el, depth < 8 {
        if let s = selectedText(of: cur) { return ["text": s] }
        el = axValue(cur, kAXParentAttribute).map { $0 as! AXUIElement }
        depth += 1
    }
    return ["error": "선택된 글을 읽지 못했습니다", "code": "empty"]
}

func emit(_ obj: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: obj),
          var line = String(data: data, encoding: .utf8) else { return }
    line += "\n"
    FileHandle.standardOutput.write(line.data(using: .utf8)!)
}

// 요청을 읽어서 같은 오류로 계속 답한다 (번역을 쓸 수 없는 경우)
func answerAllWithError(code: String, message: String) {
    while let line = readLine() {
        guard let data = line.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let id = obj["id"] else { continue }
        emit(["id": id, "error": message, "code": code])
    }
}

@main
struct ZhkoTranslate {
    static func main() async {
        if CommandLine.arguments.contains("--selected-text") {
            emit(readSelectedText())
            return
        }
        if #available(macOS 26.0, *) {
            await run()
        } else {
            let msg = "애플 번역은 macOS 26(Tahoe) 이상에서 쓸 수 있습니다"
            emit(["ready": false, "code": "os", "error": msg])
            answerAllWithError(code: "os", message: msg)
        }
    }

    @available(macOS 26.0, *)
    static func run() async {
        let source = Locale.Language(identifier: "zh-Hans")
        let target = Locale.Language(identifier: "ko")

        let status = await LanguageAvailability().status(from: source, to: target)
        switch status {
        case .installed:
            break
        case .supported:
            let msg = "중국어(간체)·한국어 번역 언어가 아직 설치되지 않았습니다. 시스템 설정 → 일반 → 언어 및 지역 → 번역 언어에서 내려받아 주세요"
            emit(["ready": false, "code": "not-installed", "error": msg])
            answerAllWithError(code: "not-installed", message: msg)
            return
        case .unsupported:
            let msg = "이 Mac 에서는 중국어 → 한국어 애플 번역을 지원하지 않습니다"
            emit(["ready": false, "code": "unsupported", "error": msg])
            answerAllWithError(code: "unsupported", message: msg)
            return
        @unknown default:
            break
        }

        let session = TranslationSession(installedSource: source, target: target)
        emit(["ready": true])

        while let line = readLine() {
            guard let data = line.data(using: .utf8),
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let id = obj["id"],
                  let text = obj["text"] as? String else { continue }
            do {
                let response = try await session.translate(text)
                emit(["id": id, "text": response.targetText])
            } catch {
                emit(["id": id, "error": error.localizedDescription, "code": "failed"])
            }
        }
    }
}

// 중한 공부 번역기 - macOS 애플 번역 도우미
// Apple Translation 프레임워크(기기 안에서 동작, 무료)로 중국어(간체) → 한국어 번역.
// 표준 입력으로 한 줄에 하나씩 {"id": 1, "text": "..."} 를 받고,
// 표준 출력으로 {"id": 1, "text": "..."} 또는 {"id": 1, "error": "...", "code": "..."} 를 돌려준다.
// 시작하자마자 상태 한 줄 {"ready": true} 또는 {"ready": false, "code": "...", "error": "..."} 을 먼저 보낸다.
// 앱 없이 직접 세션을 만드는 API(TranslationSession(installedSource:target:))는 macOS 26 부터 지원.

import Foundation
import Translation

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

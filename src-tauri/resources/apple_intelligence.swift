import Foundation
import NaturalLanguage

struct InputData: Codable {
    let diff: String
    let status: String
    let prompt: String
    let style: String
}

let codeKeywords: Set<String> = [
    "pub", "fn", "let", "mut", "var", "const", "return", "self", "struct", "class", 
    "import", "async", "await", "function", "export", "default", "type", "interface",
    "enum", "match", "impl", "trait", "static", "crate", "super", "null", "none", "some", "ok", "err",
    "true", "false", "for", "while", "loop", "if", "else", "where", "use", "mod", "as", "ref"
]

guard let data = try? FileHandle.standardInput.readToEnd(),
      let input = try? JSONDecoder().decode(InputData.self, from: data) else {
    exit(1)
}

let lines = input.diff.components(separatedBy: .newlines)
var addedTokens: [String] = []
var modifiedFiles: [String] = []

for line in lines {
    let trimmed = line.trimmingCharacters(in: .whitespaces)
    if trimmed.hasPrefix("+++ b/") {
        let path = String(trimmed.dropFirst(6))
        if !modifiedFiles.contains(path) { modifiedFiles.append(path) }
    } else if trimmed.hasPrefix("+") && !trimmed.hasPrefix("+++") {
        let code = String(trimmed.dropFirst()).trimmingCharacters(in: .whitespaces)
        if !code.isEmpty && !code.hasPrefix("//") && !code.hasPrefix("#") && !code.hasPrefix("/*") {
            let words = code.components(separatedBy: CharacterSet.alphanumerics.inverted)
                .filter { $0.count >= 3 && !codeKeywords.contains($0.lowercased()) }
            addedTokens.append(contentsOf: words)
        }
    }
}

if modifiedFiles.isEmpty {
    for line in input.status.components(separatedBy: .newlines) {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        if trimmed.count > 2 {
            let file = String(trimmed.dropFirst(2)).trimmingCharacters(in: .whitespaces)
            if !file.isEmpty { modifiedFiles.append(file) }
        }
    }
}

var scope = "core"
if let firstFile = modifiedFiles.first {
    let parts = firstFile.components(separatedBy: "/")
    if parts.count > 1 {
        let dir = parts[parts.count - 2]
        if dir != "src" && dir != "lib" && dir != "src-tauri" {
            scope = dir
        } else {
            scope = parts[parts.count - 1].replacingOccurrences(of: "\\.[^.]+$", with: "", options: .regularExpression)
        }
    } else {
        scope = firstFile.replacingOccurrences(of: "\\.[^.]+$", with: "", options: .regularExpression)
    }
}

let sampleText = addedTokens.prefix(50).joined(separator: " ")
let tagger = NLTagger(tagSchemes: [.lexicalClass, .lemma])
tagger.string = sampleText.isEmpty ? (input.status.isEmpty ? "update repository files" : input.status) : sampleText

var verbs: [String] = []
var nouns: [String] = []

tagger.enumerateTags(in: tagger.string!.startIndex..<tagger.string!.endIndex, unit: .word, scheme: .lexicalClass, options: [.omitWhitespace, .omitPunctuation, .omitOther]) { tag, range in
    let word = String(tagger.string![range]).lowercased()
    if word.count < 3 || codeKeywords.contains(word) { return true }
    if tag == .verb && !verbs.contains(word) {
        verbs.append(word)
    } else if (tag == .noun || tag == .otherWord) && !nouns.contains(word) {
        nouns.append(word)
    }
    return true
}

var commitType = "feat"
if let embedding = NLEmbedding.wordEmbedding(for: .english) {
    let candidates: [(String, [String])] = [
        ("fix", ["repair", "fix", "error", "bug", "crash", "prevent", "guard", "handle", "correct"]),
        ("feat", ["create", "add", "implement", "support", "feature", "new", "integrate"]),
        ("refactor", ["refactor", "cleanup", "simplify", "reorganize", "rewrite", "structure", "remove"]),
        ("perf", ["speed", "optimize", "fast", "cache", "performance"]),
        ("test", ["test", "verify", "assert", "mock", "spec", "check"]),
        ("docs", ["document", "readme", "explain", "guide", "comment"])
    ]
    
    var bestType = "feat"
    var bestDist = 1.5
    
    for (t, anchors) in candidates {
        for token in (verbs + nouns).prefix(10) {
            for anchor in anchors {
                let dist = embedding.distance(between: token, and: anchor)
                if dist < bestDist {
                    bestDist = dist
                    bestType = t
                }
            }
        }
    }
    commitType = bestType
}

let primaryVerb: String
if commitType == "fix" {
    primaryVerb = "fix"
} else if commitType == "refactor" {
    primaryVerb = "refactor"
} else if commitType == "test" {
    primaryVerb = "test"
} else if commitType == "docs" {
    primaryVerb = "document"
} else if commitType == "perf" {
    primaryVerb = "optimize"
} else {
    primaryVerb = verbs.first ?? "add"
}

let descriptiveNouns = nouns.prefix(3).joined(separator: " ")
let summaryAction = descriptiveNouns.isEmpty ? "update repository files" : "\(primaryVerb) \(descriptiveNouns)"

if input.style == "detailed" {
    var res = "\(commitType)(\(scope)): \(summaryAction)\n\n"
    res += "### Changes\n"
    for file in modifiedFiles.prefix(6) {
        res += "- Update `\(file)`\n"
    }
    print(res)
} else if input.style == "concise" {
    print("\(summaryAction.capitalized).")
} else {
    print("\(commitType)(\(scope)): \(summaryAction)")
}

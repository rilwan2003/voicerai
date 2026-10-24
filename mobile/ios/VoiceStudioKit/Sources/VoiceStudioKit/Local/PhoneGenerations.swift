import Foundation

public struct PhoneGeneration: Codable, Sendable, Identifiable {
    public let id: UUID
    public let text: String
    public let createdAt: Date
}
public actor PhoneGenerationStore {
    private let root: URL
    public init(root: URL) throws { self.root = root; try PrivateFiles.directory(root) }
    public func list() throws -> [PhoneGeneration] {
        try FileManager.default.contentsOfDirectory(at: root,includingPropertiesForKeys: nil).filter { $0.pathExtension == "json" }.compactMap { try? PrivateFiles.read(PhoneGeneration.self,from: PrivateFiles.child(root,$0.lastPathComponent)) }.sorted { $0.createdAt > $1.createdAt }
    }
    public func save(text: String, audio: LocalAudio) throws -> PhoneGeneration {
        let item = PhoneGeneration(id: UUID(),text: text,createdAt: Date())
        let url = try file(item)
        do {
            try audio.markSynthetic().write(to: url,options: .atomic)
            try Task.checkCancellation()
            try PrivateFiles.write(item,to: root.appendingPathComponent(item.id.uuidString+".json")); return item
        } catch { try? FileManager.default.removeItem(at: url); throw error }
    }
    public func file(_ item: PhoneGeneration) throws -> URL { try PrivateFiles.child(root,item.id.uuidString+".wav") }
    public func delete(_ item: PhoneGeneration) throws {
        try FileManager.default.removeItem(at: root.appendingPathComponent(item.id.uuidString+".json"))
        try FileManager.default.removeItem(at: file(item))
    }
}

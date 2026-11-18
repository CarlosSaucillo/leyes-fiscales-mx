// Extrae el texto de un PDF usando PDFKit (incluido en macOS).
// Uso: swift scripts/pdf_a_texto.swift archivo.pdf > archivo.txt
import PDFKit

let args = CommandLine.arguments
guard args.count > 1, let doc = PDFDocument(url: URL(fileURLWithPath: args[1])) else {
    FileHandle.standardError.write("No se pudo abrir el PDF\n".data(using: .utf8)!)
    exit(1)
}
print(doc.string ?? "")

import Foundation

#if canImport(Darwin)
import Darwin
#elseif canImport(Glibc)
import Glibc
#endif

func writeResponse(_ response: String) {
    print(response)
    fflush(stdout)
}

while let line = readLine() {
    guard let data = line.data(using: .utf8),
          let object = try? JSONSerialization.jsonObject(with: data),
          let request = object as? [String: Any] else {
        writeResponse("{\"ok\":false,\"error\":\"invalid_json\",\"protocol_version\":1}")
        continue
    }

    guard request["method"] as? String == "health" else {
        writeResponse("{\"ok\":false,\"error\":\"unsupported_method\",\"protocol_version\":1}")
        continue
    }

    writeResponse("{\"ok\":true,\"runtime\":\"swift\",\"protocol_version\":1}")
}

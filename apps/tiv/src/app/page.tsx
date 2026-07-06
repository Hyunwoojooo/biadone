import { UrlInputForm } from "@/components/UrlInputForm";

export default function HomePage() {
  return (
    <main style={{ maxWidth: 720, margin: "80px auto", padding: 24 }}>
      <h1>JARVIS Context Mapper</h1>
      <UrlInputForm />
    </main>
  );
}

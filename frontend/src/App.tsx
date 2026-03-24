import { useState } from "react";

type FormData = {
  name: string;
  message: string;
};

type ApiResponse = {
  ok: boolean;
  queued?: boolean;
  messageId?: string;
  error?: string;
  detail?: string;
};

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3002";

export default function App() {
  const [form, setForm] = useState<FormData>({ name: "", message: "" });
  const [status, setStatus] = useState<string>("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("Enviando...");

    try {
      const response = await fetch(`${API_URL}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      const data = (await response.json()) as ApiResponse;

      if (!response.ok || !data.ok) {
        setStatus(`Error: ${data.error || data.detail || "fallo desconocido"}`);
        return;
      }

      setStatus(`Enviado correctamente. messageId=${data.messageId}`);
      setForm({ name: "", message: "" });
    } catch (error) {
      setStatus(`Error de red: ${error instanceof Error ? error.message : "desconocido"}`);
    }
  };

  return (
    <div style={{ maxWidth: 720, margin: "40px auto", fontFamily: "sans-serif", padding: 24 }}>
      <h1>Formulario React → API TLS → RabbitMQ</h1>
      <p>El frontend no se conecta directo al broker. Toda la seguridad vive en backend y worker.</p>

      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 16 }}>
        <input
          placeholder="Nombre"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          style={{ padding: 12 }}
        />
        <textarea
          placeholder="Mensaje"
          value={form.message}
          onChange={(e) => setForm({ ...form, message: e.target.value })}
          style={{ padding: 12, minHeight: 120 }}
        />
        <button type="submit" style={{ padding: 12, cursor: "pointer" }}>
          Enviar
        </button>
      </form>

      {status && <pre style={{ marginTop: 24, whiteSpace: "pre-wrap" }}>{status}</pre>}
    </div>
  );
}

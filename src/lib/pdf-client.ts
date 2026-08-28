/**
 * Ask the server to make the PDF for a report or an invoice.
 *
 * A plain fetch rather than a server action, because the render needs a longer
 * timeout than a page's actions get, and only a route handler can ask for one.
 * Shared so the publish button, the card and the invoice editor cannot drift
 * into calling it differently.
 */
export async function requestDocumentPdf(
  kind: "report" | "invoice",
  id: string,
): Promise<{ ok: true; name: string } | { ok: false; message: string }> {
  try {
    const res = await fetch(`/api/${kind}s/${id}/pdf`, { method: "POST" });
    if (!res.ok) {
      return {
        ok: false,
        message: `The PDF service returned ${res.status}. Attach one by hand and the send works the same.`,
      };
    }
    return await res.json();
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof Error
          ? `Could not reach the PDF service: ${e.message}`
          : "Could not reach the PDF service.",
    };
  }
}

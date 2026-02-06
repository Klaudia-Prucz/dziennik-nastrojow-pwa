import { serve } from "https://deno.land/std/http/server.ts";

const SYSTEM = `Jesteś empatycznym, konkretnym asystentem wellbeing.
Nie diagnozujesz i nie używasz języka medycznego.
Dajesz krótką poradę 2–3 zdania + 1 konkretne działanie na dziś.
Unikasz banałów i ocen.`;

function buildPrompt(p: any) {
  return `Podsumowanie ostatnich ${p.days} dni:
- Stan: ${p.state}
- Wynik: ${p.score10}/10
- Średni nastrój: ${p.avgMood}/10
- Średnia energia: ${p.avgEnergy}/10
- Średni stres: ${p.avgStress}/10 (im mniej tym lepiej)
- Interpretacja: ${p.level}

Wygeneruj radę po polsku: 2–3 zdania + jedno konkretne działanie na dziś (1 punkt listy).`;
}

serve(async (req) => {
  const payload = await req.json();
  const prompt = buildPrompt(payload);

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: prompt },
      ],
      temperature: 0.6,
    }),
  });

  const data = await r.json();
  const advice = data?.choices?.[0]?.message?.content ?? "Nie udało się wygenerować rady.";

  return new Response(JSON.stringify({ advice }), {
    headers: { "Content-Type": "application/json" },
  });
});


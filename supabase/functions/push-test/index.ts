import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import webpush from "npm:web-push@3.6.7";

Deno.serve(async (req) => {
  try {
    const payload = await req.json();

    console.log("push-test payload keys:", Object.keys(payload ?? {}));

    const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY");
    const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");
    const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT");

    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing VAPID env vars" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);


    const { title = "Test", body = "Powiadomienie działa ✅" } = payload;

    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return new Response(JSON.stringify({ ok:false, error:"Bad subscription payload" }), { status: 400 });
    }

    try {
      const res = await webpush.sendNotification(subscription, JSON.stringify({ title, body }));
      console.log("webpush status:", res.statusCode);
      return new Response(JSON.stringify({ ok:true, status: res.statusCode }), { headers: { "Content-Type":"application/json" }});
    } catch (e) {
      console.error("webpush error:", e);
      return new Response(JSON.stringify({ ok:false, error: String(e) }), { status: 500 });
    }

    const subscription = (await req.json())?.subscription; // jeśli wyślesz ją w body
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing subscription in request body" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    await webpush.sendNotification(
      subscription,
      JSON.stringify({ title, body })
    );

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.log("push-test error:", e?.message || e);
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

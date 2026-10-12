import { resolve } from "node:path";
import { loadConfig, saveConfig, sendTelegram, telegramSecrets, saveTelegramSecrets, telegramBotName, findTelegramChat, looksLikeToken, maskToken, personalConfigPath } from "@rawjobs/core";
import { readStdin } from "../util";

/** Telegram alerts (JSON in and out, for the dashboard): status, token, connect, test, off. */
export async function cmdAlerts(args: string[]): Promise<number> {
  const [channel, action = "status"] = args;
  const out = (o: Record<string, unknown>) => console.log(JSON.stringify(o));
  if (channel !== "telegram") {
    console.error("Usage: rawjobs alerts telegram <status|token|connect|test|off>");
    return 2;
  }
  const setEnabled = (on: boolean) => {
    const { config, path } = loadConfig();
    if (resolve(path) !== personalConfigPath()) return;
    if (config.alerts.telegram !== on) saveConfig({ ...config, alerts: { ...config.alerts, telegram: on } });
  };
  try {
    const secrets = telegramSecrets();
    if (action === "status") {
      let enabled = false;
      try {
        enabled = loadConfig().config.alerts.telegram;
      } catch {
        // no config yet
      }
      out({ ok: true, token: maskToken(secrets.token) ?? null, bot: secrets.bot ?? null, connected: !!secrets.chatId, enabled, fromEnv: !!process.env.TELEGRAM_BOT_TOKEN });
      return 0;
    }
    if (action === "token") {
      const token = String((JSON.parse((await readStdin()) || "{}") as { token?: unknown }).token ?? "").trim();
      if (!looksLikeToken(token)) {
        out({ ok: false, error: "That doesn't look like a bot token. It looks like 123456789:AAF… and comes from @BotFather." });
        return 0;
      }
      const bot = await telegramBotName(token);
      saveTelegramSecrets({ token, chatId: "", bot });
      out({ ok: true, bot });
      return 0;
    }
    if (!secrets.token) {
      out({ ok: false, error: "Add your bot token first." });
      return 0;
    }
    if (action === "connect") {
      const chat = await findTelegramChat(secrets.token);
      if (!chat) {
        out({ ok: false, error: 'No message from you yet. Open your bot in Telegram, press Start (or send it "hi"), then try again.' });
        return 0;
      }
      saveTelegramSecrets({ chatId: chat.chatId });
      setEnabled(true);
      await sendTelegram("✅ RawJobs is connected. New jobs from your scans will arrive here.", { ...secrets, chatId: chat.chatId });
      out({ ok: true, name: chat.name });
      return 0;
    }
    if (action === "test") {
      await sendTelegram("👋 Test from RawJobs. Alerts are working.", secrets);
      out({ ok: true });
      return 0;
    }
    if (action === "on" || action === "off") {
      setEnabled(action === "on");
      out({ ok: true });
      return 0;
    }
    if (action === "forget") {
      saveTelegramSecrets({ token: "", chatId: "", bot: "" });
      setEnabled(false);
      out({ ok: true });
      return 0;
    }
    out({ ok: false, error: `Unknown action "${action}".` });
    return 2;
  } catch (err) {
    out({ ok: false, error: (err as Error).message });
    return 0;
  }
}

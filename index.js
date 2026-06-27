// ==============================
// DNS対策（VPS安定用）
// ==============================
const dns = require("node:dns");
dns.setDefaultResultOrder("ipv4first");

// ==============================
// 初期設定
// ==============================
require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
} = require("discord.js");

const AA_LIST = require("./aa");
const OPOONA_AA_LIST = require("./opoona-aa");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ==============================
// 定数
// ==============================
const GUIDE_TEXT = "やる夫とオプーナで反応するおww";

// Discordは1メッセージ最大2000文字。
// メンション・コードブロック分を考慮して余裕を持たせる。
const AA_CHUNK_MAX_LENGTH = 1800;

// チャンネルごとに、直前の案内メッセージIDを保存
const lastGuideMessageIds = new Map();

// ==============================
// ユーティリティ
// ==============================
function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * AAを行単位で分割する。
 * Discordの2000文字制限を超えるAAにも対応。
 */
function splitAaByLines(aa, maxLength = AA_CHUNK_MAX_LENGTH) {
  const lines = String(aa).trim().split("\n");
  const chunks = [];

  let currentChunk = "";

  for (const line of lines) {
    const nextChunk = currentChunk
      ? `${currentChunk}\n${line}`
      : line;

    if (nextChunk.length > maxLength && currentChunk) {
      chunks.push(currentChunk);
      currentChunk = line;
    } else {
      currentChunk = nextChunk;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}

/**
 * Mapに保存されている前回の案内を削除する。
 */
async function deleteSavedGuide(channel) {
  const guideMessageId = lastGuideMessageIds.get(channel.id);

  if (!guideMessageId) return;

  try {
    const guideMessage = await channel.messages.fetch(guideMessageId);
    await guideMessage.delete();

    console.log(`🗑 前回の案内を削除: ${channel.id}`);
  } catch (error) {
    // すでに削除されている場合などは無視
    console.log(
      `⚠️ 保存済み案内の削除をスキップ: ${error?.message ?? error}`
    );
  } finally {
    lastGuideMessageIds.delete(channel.id);
  }
}

/**
 * Bot再起動前に投稿された案内を削除する。
 * 最新100件からBot自身の同一文面を探す。
 */
async function deleteRemainingGuides(channel) {
  try {
    const messages = await channel.messages.fetch({
      limit: 100,
    });

    const oldGuides = messages.filter((message) => {
      return (
        message.author.id === client.user.id &&
        message.content === GUIDE_TEXT
      );
    });

    for (const message of oldGuides.values()) {
      try {
        await message.delete();
        console.log(`🗑 古い案内を削除: ${message.id}`);
      } catch (error) {
        console.log(
          `⚠️ 古い案内を削除できませんでした: ${error?.message ?? error}`
        );
      }
    }
  } catch (error) {
    console.log(
      `⚠️ 過去メッセージ取得失敗: ${error?.message ?? error}`
    );
  }
}

/**
 * 以前の案内をすべて削除する。
 */
async function deletePreviousGuides(channel) {
  await deleteSavedGuide(channel);
  await deleteRemainingGuides(channel);
}

/**
 * AAを送信する。
 * 分割された場合、最初のメッセージだけユーザーをメンションする。
 */
async function sendAa(channel, userId, aa) {
  const chunks = splitAaByLines(aa);

  for (let index = 0; index < chunks.length; index += 1) {
    const mention = index === 0
      ? `<@${userId}>\n\n`
      : "";

    await channel.send(
      `${mention}\`\`\`txt\n${chunks[index]}\n\`\`\``
    );
  }
}

/**
 * 案内文を送信し、IDを保存する。
 */
async function sendGuide(channel) {
  const guideMessage = await channel.send(GUIDE_TEXT);

  lastGuideMessageIds.set(
    channel.id,
    guideMessage.id
  );

  console.log(`📌 案内を更新: ${channel.id}`);
}

/**
 * メッセージ内容から使用するAAを決定する。
 * オプーナを最優先。
 */
function selectResponse(content) {
  const includesOpoona = content.includes("オプーナ");
  const includesYaruo = content.includes("やる夫");

  if (includesOpoona) {
    if (
      !Array.isArray(OPOONA_AA_LIST) ||
      OPOONA_AA_LIST.length === 0
    ) {
      return {
        ok: false,
        reason: "オプーナAAが登録されていません",
      };
    }

    return {
      ok: true,
      type: "オプーナ",
      aa: pick(OPOONA_AA_LIST),
    };
  }

  if (includesYaruo) {
    if (
      !Array.isArray(AA_LIST) ||
      AA_LIST.length === 0
    ) {
      return {
        ok: false,
        reason: "やる夫AAが登録されていません",
      };
    }

    return {
      ok: true,
      type: "やる夫",
      aa: pick(AA_LIST),
    };
  }

  return {
    ok: false,
    ignored: true,
  };
}

// ==============================
// 起動確認
// ==============================
client.once("clientReady", () => {
  console.log("=================================");
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`📦 やる夫AA登録数: ${AA_LIST.length}`);
  console.log(`🎮 オプーナAA登録数: ${OPOONA_AA_LIST.length}`);
  console.log("=================================");
});

// ==============================
// メッセージ検知
// ==============================
client.on("messageCreate", async (msg) => {
  try {
    // Botの発言には反応しない
    if (msg.author.bot) return;

    // 通常のテキスト投稿以外を除外
    if (!msg.channel?.isTextBased()) return;

    const content = msg.content.trim();

    if (!content) return;

    const response = selectResponse(content);

    // キーワードがなければ何もしない
    if (response.ignored) return;

    if (!response.ok) {
      console.log(`⚠️ ${response.reason}`);
      return;
    }

    // 以前の「やる夫で反応するおwww」を先に削除
    await deletePreviousGuides(msg.channel);

    // ランダムに選ばれたAAを送信
    await sendAa(
      msg.channel,
      msg.author.id,
      response.aa
    );

    // 案内文を最下部へ再投稿
    await sendGuide(msg.channel);

    console.log(
      `✅ ${response.type}反応: ` +
      `${msg.author.tag} / ` +
      `${msg.channel.id}`
    );
  } catch (error) {
    console.error("❌ messageCreate error:", error);
  }
});

// ==============================
// Discordクライアントエラー
// ==============================
client.on("error", (error) => {
  console.error("❌ Discord client error:", error);
});

client.on("warn", (warning) => {
  console.warn("⚠️ Discord client warning:", warning);
});

// ==============================
// プロセスエラー
// ==============================
process.on("unhandledRejection", (error) => {
  console.error("❌ unhandledRejection:", error);
});

process.on("uncaughtException", (error) => {
  console.error("❌ uncaughtException:", error);
});

// ==============================
// ログイン
// ==============================
if (!process.env.DISCORD_TOKEN) {
  console.error("❌ DISCORD_TOKENが.envに設定されていません");
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);
const TelegramBot = require("node-telegram-bot-api");
const admin = require("firebase-admin");
const PDFDocument = require("pdfkit");
const fs = require("fs");

/* ================= CONFIG ================= */

const TOKEN = "8790507638:AAHdLCP-wHR4caN_s9Vt20akFI7bZBEqVyI";
const ADMIN_ID = 6722195724;
const CASHIERS = [7923593088];

/* ================= FIREBASE ================= */

const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const bot = new TelegramBot(TOKEN, { polling: true });

bot.on("polling_error", (err) => console.log("Polling error:", err.message));
console.log("🚀 Bot ishga tushdi!");

/* ================= ROLE ================= */

function getRole(id) {
  if (id === ADMIN_ID) return "admin";
  if (CASHIERS.includes(id)) return "cashier";
  return "unknown";
}

/* ================= STATE ================= */

const state = {};

/* ================= DATA ================= */

const employees = [
  "Alisher - Raxbar",
  "Husanboy - Bosh oshpaz",
  "Mahsud aka - Tayorlovchi",
  "Sherxon - Kassir",
  "Bobur - Go'shtpaz",
  "Komiljon - Go'shtpaz",
  "Oshpaz aka - Oshpaz",
  "Axmadjon - Somspaz",
  "Maxmudjon - Shashlikpaz"
];

const waiters = Array.from({ length: 10 }, (_, i) => `Ofitsant ${i+1}`);
const kommunal = ["Suv", "Svet", "Gaz", "Soliq"];

/* ================= HELPERS ================= */

function formatMoney(n) {
  return Number(n).toLocaleString("uz-UZ") + " so'm";
}

function parseMoney(text) {
  return parseInt(text.replace(/\s/g, ""));
}

function getMonthRange(monthName) {
  const months = {
    "Yanvar":0,"Fevral":1,"Mart":2,"Aprel":3,"May":4,"Iyun":5,
    "Iyul":6,"Avgust":7,"Sentabr":8,"Oktabr":9,"Noyabr":10,"Dekabr":11
  };

  const year = new Date().getFullYear();
  const month = months[monthName];

  const start = admin.firestore.Timestamp.fromDate(new Date(year, month, 1));
  const end = admin.firestore.Timestamp.fromDate(new Date(year, month+1, 1));

  return { start, end };
}

function getTodayRange() {
  const today = new Date();
  const start = admin.firestore.Timestamp.fromDate(
    new Date(today.getFullYear(), today.getMonth(), today.getDate())
  );
  const end = admin.firestore.Timestamp.fromDate(
    new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
  );
  return { start, end };
}

async function deleteCollection(collectionName) {
  const snapshot = await db.collection(collectionName).get();
  const batch = db.batch();
  snapshot.docs.forEach(doc => batch.delete(doc.ref));
  await batch.commit();
}

function mainMenu(id) {
  const role = getRole(id);

  if (role === "admin") {
    return bot.sendMessage(id, "🏠 Asosiy menyu:", {
      reply_markup: {
        keyboard: [
          ["💰 Kirim", "💸 Chiqim"],
          ["📊 Hisobot"],
          ["📄 Bugungi PDF"],
          ["⚙️ Sozlamalar"]
        ],
        resize_keyboard: true
      }
    });
  }

  return bot.sendMessage(id, "🏠 Asosiy menyu:", {
    reply_markup: {
      keyboard: [
        ["💰 Kirim", "💸 Chiqim"]
      ],
      resize_keyboard: true
    }
  });
}

/* ================= START ================= */

bot.onText(/\/start/, (msg) => {
  const role = getRole(msg.chat.id);
  if (role === "unknown")
    return bot.sendMessage(msg.chat.id, "⛔ Ruxsat yo‘q");

  mainMenu(msg.chat.id);
});

/* ================= MESSAGE ================= */

bot.on("message", async (msg) => {

  const id = msg.chat.id;
  const text = msg.text;
  const role = getRole(id);

  if (!text || role === "unknown" || text === "/start") return;

  try {

/* ================= BACK ================= */

if (text === "🔙 Orqaga") {
  state[id] = null;
  return mainMenu(id);
}

/* ================= SOZLAMALAR ================= */

if (text === "⚙️ Sozlamalar" && role === "admin") {
  state[id] = { type: "settings" };

  return bot.sendMessage(id,"⚙️ Sozlamalar:",{
    reply_markup:{
      keyboard:[
        ["🗑 Barcha ma’lumotlarni o‘chirish"],
        ["🔙 Orqaga"]
      ],
      resize_keyboard:true
    }
  });
}

if (state[id]?.type === "settings" && text === "🗑 Barcha ma’lumotlarni o‘chirish") {
  state[id] = { type: "reset_confirm" };

  return bot.sendMessage(
    id,
    "⚠️ DIQQAT!\n\nBarcha kirim va chiqimlar O‘CHIRILADI!\n\nTasdiqlaysizmi?",
    {
      reply_markup: {
        keyboard: [
          ["✅ Ha, o‘chirish"],
          ["❌ Bekor qilish"]
        ],
        resize_keyboard: true
      }
    }
  );
}

if (state[id]?.type === "reset_confirm") {

  if (text === "❌ Bekor qilish") {
    state[id] = null;
    return mainMenu(id);
  }

  if (text === "✅ Ha, o‘chirish") {
    await deleteCollection("incomes");
    await deleteCollection("expenses");
    state[id] = null;
    await bot.sendMessage(id,"✅ Barcha ma’lumotlar o‘chirildi!");
    return mainMenu(id);
  }
}

/* ================= PDF ================= */

if (text === "📄 Bugungi PDF" && role === "admin") {

  const { start, end } = getTodayRange();

  const incomesSnap = await db.collection("incomes")
    .where("createdAt", ">=", start)
    .where("createdAt", "<", end)
    .get();

  const expensesSnap = await db.collection("expenses")
    .where("createdAt", ">=", start)
    .where("createdAt", "<", end)
    .get();

  let incomeCash = 0, incomeClick = 0;
  let expenseCash = 0, expenseClick = 0;

  incomesSnap.forEach(doc => {
    const d = doc.data();
    if (d.payment === "💵 Naqd") incomeCash += d.amount;
    if (d.payment === "💳 Click") incomeClick += d.amount;
  });

  expensesSnap.forEach(doc => {
    const d = doc.data();
    if (d.payment === "💵 Naqd") expenseCash += d.amount;
    if (d.payment === "💳 Click") expenseClick += d.amount;
  });

  const incomeTotal = incomeCash + incomeClick;
  const expenseTotal = expenseCash + expenseClick;

  const fileName = `kunlik_${Date.now()}.pdf`;
  const doc = new PDFDocument({ margin: 40 });
  const stream = fs.createWriteStream(fileName);

  doc.pipe(stream);

  doc.fontSize(18).text("Firdaus Taomlar Markazi", { align: "center" });
  doc.moveDown();
  doc.fontSize(14).text("Kunlik hisobot", { align: "center" });
  doc.moveDown();

  doc.text("KIRIM:");
  doc.text("Naqd: " + formatMoney(incomeCash));
  doc.text("Click: " + formatMoney(incomeClick));
  doc.text("Jami: " + formatMoney(incomeTotal));
  doc.moveDown();

  doc.text("CHIQIM:");
  doc.text("Naqd: " + formatMoney(expenseCash));
  doc.text("Click: " + formatMoney(expenseClick));
  doc.text("Jami: " + formatMoney(expenseTotal));
  doc.moveDown();

  doc.text("BALANS: " + formatMoney(incomeTotal - expenseTotal));

  doc.end();

  stream.on("finish", async () => {
    await bot.sendDocument(id, fileName);
    fs.unlinkSync(fileName);
  });

  return;
}

/* ================= KIRIM ================= */

if (text === "💰 Kirim") {
  state[id] = { type: "income", step: 1 };
  return bot.sendMessage(id,"💳 To‘lov turini tanlang:",{
    reply_markup:{
      keyboard:[["💵 Naqd","💳 Click"],["🔙 Orqaga"]],
      resize_keyboard:true
    }
  });
}

if (state[id]?.type === "income") {

  if (state[id].step === 1) {
    state[id].payment = text;
    state[id].step = 2;
    return bot.sendMessage(id,"💰 Summani kiriting:");
  }

  if (state[id].step === 2) {
    const amount = parseMoney(text);
    if (isNaN(amount))
      return bot.sendMessage(id,"❌ Noto‘g‘ri summa");

    await db.collection("incomes").add({
      amount,
      payment: state[id].payment,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    state[id] = null;
    await bot.sendMessage(id,"✅ Kirim saqlandi");
    return mainMenu(id);
  }
}

/* ================= CHIQIM ================= */

if (text === "💸 Chiqim") {
  state[id] = { type: "expense", step: 1 };
  return bot.sendMessage(id,"📂 Chiqim turini tanlang:",{
    reply_markup:{
      keyboard:[
        ["Maosh","Kunlik maosh"],
        ["Kommunal","Xarajat"],
        ["🔙 Orqaga"]
      ],
      resize_keyboard:true
    }
  });
}

if (state[id]?.type === "expense") {

  if (state[id].step === 1) {
    state[id].category = text;
    state[id].step = 2;
    return bot.sendMessage(id,"💳 To‘lov turini tanlang:",{
      reply_markup:{
        keyboard:[["💵 Naqd","💳 Click"],["🔙 Orqaga"]],
        resize_keyboard:true
      }
    });
  }

  if (state[id].step === 2) {
    state[id].payment = text;

    if (state[id].category === "Maosh") {
      state[id].step = 3;
      return bot.sendMessage(id,"👤 Ishchini tanlang:",{
        reply_markup:{
          keyboard: employees.map(e=>[e]).concat([["🔙 Orqaga"]]),
          resize_keyboard:true
        }
      });
    }

    if (state[id].category === "Kunlik maosh") {
      state[id].step = 3;
      return bot.sendMessage(id,"👤 Ofitsantni tanlang:",{
        reply_markup:{
          keyboard: waiters.map(w=>[w]).concat([["🔙 Orqaga"]]),
          resize_keyboard:true
        }
      });
    }

    if (state[id].category === "Kommunal") {
      state[id].step = 3;
      return bot.sendMessage(id,"💡 Kommunal turini tanlang:",{
        reply_markup:{
          keyboard: kommunal.map(k=>[k]).concat([["🔙 Orqaga"]]),
          resize_keyboard:true
        }
      });
    }

    if (state[id].category === "Xarajat") {
      state[id].step = 4;
      return bot.sendMessage(id,"✏️ Nimaga ishlatildi?");
    }
  }

  if (state[id].step === 3 || state[id].step === 4) {
    state[id].name = text;
    state[id].step = 5;
    return bot.sendMessage(id,"💰 Summani kiriting:");
  }

  if (state[id].step === 5) {
    const amount = parseMoney(text);
    if (isNaN(amount))
      return bot.sendMessage(id,"❌ Noto‘g‘ri summa");

    await db.collection("expenses").add({
      category: state[id].category,
      name: state[id].name,
      payment: state[id].payment,
      amount,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    state[id] = null;
    await bot.sendMessage(id,"✅ Chiqim saqlandi");
    return mainMenu(id);
  }
}

/* ================= HISOBOT ================= */

if (text === "📊 Hisobot" && role === "admin") {
  state[id] = { type: "report", step: 1 };
  return bot.sendMessage(id,"📅 Oyni tanlang:",{
    reply_markup:{
      keyboard:[
        ["Yanvar","Fevral","Mart"],
        ["Aprel","May","Iyun"],
        ["Iyul","Avgust","Sentabr"],
        ["Oktabr","Noyabr","Dekabr"],
        ["🔙 Orqaga"]
      ],
      resize_keyboard:true
    }
  });
}

if (state[id]?.type === "report" && state[id].step === 1) {
  state[id].month = text;
  state[id].step = 2;

  return bot.sendMessage(id,"📂 Hisobot turini tanlang:",{
    reply_markup:{
      keyboard:[
        ["📈 Umumiy hisobot"],
        ["👨‍🍳 Maosh hisoboti"],
        ["🧾 Kunlik maosh hisoboti"],
        ["💡 Kommunal hisoboti"],
        ["🛒 Xarajat hisoboti"],
        ["🔙 Orqaga"]
      ],
      resize_keyboard:true
    }
  });
}

if (state[id]?.type === "report" && state[id].step === 2) {

  const { start, end } = getMonthRange(state[id].month);

  const incomesSnap = await db.collection("incomes")
    .where("createdAt", ">=", start)
    .where("createdAt", "<", end)
    .get();

  const expensesSnap = await db.collection("expenses")
    .where("createdAt", ">=", start)
    .where("createdAt", "<", end)
    .get();

  let report = "";

  if (text === "📈 Umumiy hisobot") {

    let incomeCash = 0, incomeClick = 0;
    let expenseCash = 0, expenseClick = 0;

    incomesSnap.forEach(doc => {
      const d = doc.data();
      if (d.payment === "💵 Naqd") incomeCash += d.amount;
      if (d.payment === "💳 Click") incomeClick += d.amount;
    });

    expensesSnap.forEach(doc => {
      const d = doc.data();
      if (d.payment === "💵 Naqd") expenseCash += d.amount;
      if (d.payment === "💳 Click") expenseClick += d.amount;
    });

    const incomeTotal = incomeCash + incomeClick;
    const expenseTotal = expenseCash + expenseClick;

    report += "📊 UMUMIY HISOBOT\n\n";
    report += "💰 KIRIM:\n";
    report += "Naqd: " + formatMoney(incomeCash) + "\n";
    report += "Click: " + formatMoney(incomeClick) + "\n";
    report += "Jami: " + formatMoney(incomeTotal) + "\n\n";
    report += "💸 CHIQIM:\n";
    report += "Naqd: " + formatMoney(expenseCash) + "\n";
    report += "Click: " + formatMoney(expenseClick) + "\n";
    report += "Jami: " + formatMoney(expenseTotal) + "\n\n";
    report += "📈 BALANS: " + formatMoney(incomeTotal - expenseTotal);

    state[id] = null;
    await bot.sendMessage(id, report);
    return mainMenu(id);
  }

  const categoryMap = {
    "👨‍🍳 Maosh hisoboti": "Maosh",
    "🧾 Kunlik maosh hisoboti": "Kunlik maosh",
    "💡 Kommunal hisoboti": "Kommunal",
    "🛒 Xarajat hisoboti": "Xarajat"
  };

  if (categoryMap[text]) {

    let cash = 0;
    let click = 0;

    report += "Sana | Nomi | To‘lov | Summa\n";
    report += "---------------------------------------------\n";

    expensesSnap.forEach(doc => {
      const d = doc.data();

      if (d.category === categoryMap[text]) {

        const sana = d.createdAt
          ? d.createdAt.toDate().toLocaleDateString("uz-UZ")
          : "-";

        report += `${sana} | ${d.name || "-"} | ${d.payment || "-"} | ${formatMoney(d.amount)}\n`;

        if (d.payment === "💵 Naqd") cash += d.amount;
        if (d.payment === "💳 Click") click += d.amount;
      }
    });

    const total = cash + click;

    report += "---------------------------------------------\n";
    report += "💵 Naqd: " + formatMoney(cash) + "\n";
    report += "💳 Click: " + formatMoney(click) + "\n";
    report += "📊 Jami: " + formatMoney(total);

    state[id] = null;
    await bot.sendMessage(id, report);
    return mainMenu(id);
  }
}

  } catch (err) {
    console.log(err);
    bot.sendMessage(id,"⚠️ Xatolik yuz berdi");
  }

});
const express = require("express");
const app = express();

app.get("/", (req, res) => {
  res.send("Bot ishlayapti");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server ishlayapti " + PORT);
});

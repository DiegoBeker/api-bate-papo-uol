import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import dotenv from "dotenv";
import dayjs from "dayjs";
import joi from "joi";
import { stripHtml } from "string-strip-html";

const app = express();

//config
app.use(cors());
app.use(express.json());
dotenv.config();

//MongoDB
let db;
const mongoClient = new MongoClient(process.env.DATABASE_URL);
mongoClient
  .connect()
  .then(() => (db = mongoClient.db()))
  .catch((err) => console.log(err.message));

app.post("/participants", async (req, res) => {
  const time = dayjs().format("HH:mm:ss");
  const userSchema = joi.object({
    name: joi.string().required(),
  });
  const validation = userSchema.validate(req.body, { abortEarly: false });

  if (validation.error) return res.sendStatus(422);

  const name = stripHtml(req.body.name).result.trim();

  try {
    const participantExists = await db
      .collection("participants")
      .findOne({ name: name });

    if (participantExists) return res.sendStatus(409);

    await db
      .collection("participants")
      .insertOne({ name: name, lastStatus: Date.now() });

    await db.collection("messages").insertOne({
      from: name,
      to: "Todos",
      text: "entra na sala...",
      type: "status",
      time: time,
    });

    return res.sendStatus(201);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

app.get("/participants", async (req, res) => {
  try {
    const participants = await db.collection("participants").find().toArray();
    res.send(participants);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

app.post("/messages", async (req, res) => {
  const message = req.body;
  const user = req.headers.user;
  const time = dayjs().format("HH:mm:ss");
  const messageSchema = joi.object({
    to: joi.string().required(),
    text: joi.string().required(),
    type: joi.valid("message", "private_message").required(),
  });
  const validation = messageSchema.validate(message, { abortEarly: false });

  if (validation.error) {
    const errors = validation.error.details.map((detail) => detail.message);
    return res.sendStatus(422);
  }

  const cleansedMessage = {
    to: stripHtml(message.to).result.trim(),
    text: stripHtml(message.text).result.trim(),
    type: message.type,
  };

  try {
    const participantExists = await db
      .collection("participants")
      .findOne({ name: user });

    if (!participantExists) return res.sendStatus(422);

    await db.collection("messages").insertOne({
      from: user,
      to: cleansedMessage.to,
      text: cleansedMessage.text,
      type: cleansedMessage.type,
      time: time,
    });
    res.sendStatus(201);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

app.get("/messages", async (req, res) => {
  const user = req.headers.user;
  const limit = req.query.limit;
  const limitSchema = joi.number().integer().greater(0);
  const validation = limitSchema.validate(limit, { abortEarly: false });

  if (validation.error) return res.sendStatus(422);

  try {
    if (limit) {
      console.log(limit);
      const messages = await db
        .collection("messages")
        .find({ $or: [{ to: user }, { from: user }, { to: "Todos" }] })
        .toArray();
      return res.send(messages.slice(-limit));
    }
    const messages = await db
      .collection("messages")
      .find({ $or: [{ to: user }, { from: user }, { to: "Todos" }] })
      .toArray();
    res.send(messages);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

app.post("/status", async (req, res) => {
  const user = req.headers.user;

  if (!user) res.sendStatus(404);

  try {
    const participantExists = await db
      .collection("participants")
      .findOne({ name: user });

    if (!participantExists) return res.sendStatus(404);
    console.log(participantExists);
    const editedParticipant = { ...participantExists };
    editedParticipant.lastStatus = Date.now();
    console.log(editedParticipant);

    const result = await db
      .collection("participants")
      .updateOne({ _id: participantExists._id }, { $set: editedParticipant });

    res.sendStatus(200);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

app.delete("/messages/:id", async (req, res) => {
  const { id } = req.params;
  const user = req.headers.user;
  try {
    const message = await db
      .collection("messages")
      .findOne({ _id: new ObjectId(id) });

    if (!message) return res.sendStatus(404);

    if (message.from !== user) return res.sendStatus(401);

    await db.collection("messages").deleteOne({ _id: new ObjectId(id) });

    res.sendStatus(200);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

app.put("/messages/:id", async (req, res) => {
  const { id } = req.params;
  const user = req.headers.user;
  const message = req.body;
  const messageSchema = joi.object({
    to: joi.string().required(),
    text: joi.string().required(),
    type: joi.valid("message", "private_message").required(),
  });
  const validation = messageSchema.validate(message, { abortEarly: false });
  const participantExists = await db
    .collection("participants")
    .findOne({ name: user });

  if (validation.error || !participantExists) return res.sendStatus(422);

  const messageExists = await db
    .collection("messages")
    .findOne({ _id: new ObjectId(id) });

  if (!messageExists) return res.sendStatus(404);

  if (messageExists.from !== user) return res.sendStatus(401);

  await db
    .collection("messages")
    .updateOne(
      { _id: new ObjectId(id) },
      { $set: { to: message.to, text: message.text, type: message.type } }
    );
  res.sendStatus(200);
});

const PORT = 5000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));

setInterval(async () => {
  const time = Date.now() - 10000;

  try {
    const search = await db
      .collection("participants")
      .find({ lastStatus: { $lt: time } })
      .toArray();

    search.forEach(async (participant) => {
      await db.collection("participants").deleteOne({ _id: participant._id });
      await db.collection("messages").insertOne({
        from: participant.name,
        to: "Todos",
        text: "sai da sala...",
        type: "status",
        time: dayjs().format("HH:mm:ss"),
      });
    });
  } catch (error) {
    console.log("Aqui");
    console.log(error.message);
  }
}, 15000);

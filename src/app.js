import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import dotenv from "dotenv";
import joi from "joi";
import dayjs from "dayjs";
import { stripHtml } from "string-strip-html";

dotenv.config();

const participantSchema = joi.object({
    name: joi.string().trim().required()
});

const messageSchema = joi.object({
    to: joi.string().trim().required(),
    text: joi.string().trim().required(),
    type: joi.string().trim().valid("message", "private_message").required()
});

const mongoClient = new MongoClient(process.env.MONGO_URI);
let db;

try{
    await mongoClient.connect();
} catch (error) {
    console.log(error);
}

db = mongoClient.db("batePapoUol")

const server = express();
server.use(cors());
server.use(express.json());

server.post("/participants", async (req, res) => {
    const name = stripHtml(req.body.name).result.trim();
    const validation = participantSchema.validate(req.body, {abortEarly: false});

    if(validation.error){
        const errors = validation.error.details.map((detail) => detail.message);
        res.status(422).send(errors);
        return;
    }

    try{
        const existingParticipant = await db.collection("participants").findOne({name: name})
         
        if(existingParticipant) {
            res.sendStatus(409);
            return;
        }

        await db.collection("participants").insertOne({name: name, lastStatus: Date.now()})
        await db.collection("messages").insertOne({from: name, to: "Todos", text: "entra na sala...", type: "status", time: dayjs().format("HH:mm:ss")})
        res.sendStatus(201);
    } catch (error) {
        console.log(error);
        res.sendStatus(500);
    }
})

server.get("/participants", async (req, res) => {
    try{
        const participants = await db.collection("participants").find().toArray();
        res.send(participants);
    } catch (error) {
        console.log(error);
        res.sendStatus(500);
    }
})

server.post("/messages", async (req,res) => {
    const to = stripHtml(req.body.to).result;
    const text = stripHtml(req.body.text).result;
    const type = stripHtml(req.body.type).result;
    const from = req.headers.user.trim();
    const validation = messageSchema.validate(req.body, {abortEarly: false});

    if(validation.error){
        const errors = validation.error.details.map((detail) => detail.message);
        res.status(422).send(errors);
        return;
    }

    try{
        const existingParticipant = await db.collection("participants").findOne({name: from})

        if(!existingParticipant) {
            res.sendStatus(422);
            return;
        }

        await db.collection("messages").insertOne({from: from, to: to, text: text, type: type, time: dayjs().format("HH:mm:ss")})
        res.sendStatus(201);
    } catch (error){
        console.log(error);
        res.sendStatus(500);
    }
})

server.get("/messages", async (req, res) => {
    const limit = parseInt(req.query.limit)
    const participant = req.headers.user
    
    try{
        const messages = await db.collection("messages").find({$or: [
            {
              to: "Todos"
            },
            {
              to: participant
            },
            {
              from: participant
            }
          ]}).sort({_id: -1}).limit(limit).toArray()
          res.send(messages.reverse())
    } catch (error) {
        console.log(error);
        res.sendStatus(500);
    }
})

server.post("/status", async (req, res) => {
    const participant = req.headers.user

    try{
        const existingParticipant = await db.collection("participants").findOne({name: participant})

        if(!existingParticipant) {
            res.sendStatus(404);
            return;
        }       
        
        await db.collection("participants").updateOne({name: participant}, {$set:{ lastStatus:Date.now() }})
        res.sendStatus(200);
    } catch (error) {
        console.log(error);
        res.sendStatus(500);
    }
})

async function handleIdleUsers(){
    try{
        const idleParticipants = await db.collection("participants").find({lastStatus: {$lt: Date.now() - 10000} }).toArray();
        const exitMessage = idleParticipants.map((idleParticipant) => ({from: idleParticipant.name, to: "Todos", text: "sai da sala...", type: "status", time: dayjs().format("HH:mm:ss")}))

        if(idleParticipants.length !== 0){
        await db.collection("participants").deleteMany({lastStatus: {$lt: Date.now() - 10000} });
        await db.collection("messages").insertMany(exitMessage);
        }
    } catch (error) {
        console.log(error);
    }

}

setInterval(handleIdleUsers, 15000)

server.delete("/messages/:id", async (req, res) => {
    const from = req.headers.user.trim();
    const id = req.params.id;

    try {
        const existingMessage = await db.collection("messages").findOne({ _id: ObjectId(id) });

        if(!existingMessage){
            res.sendStatus(404);
            return;
        }

        if(from !== existingMessage.from){
            res.sendStatus(401);
            return;
        }

        await db.collection("messages").deleteOne({ _id: ObjectId(id) });
        res.sendStatus(200);
    } catch (error) {
        console.log(error);
        res.sendStatus(500);
    }
})

server.put("/messages/:id", async (req, res) => {
    const updatedMessage = req.body
    const from = req.headers.user.trim();
    const validation = messageSchema.validate(updatedMessage, {abortEarly: false});
    const id = req.params.id;

    if(validation.error){
        const errors = validation.error.details.map((detail) => detail.message);
        res.status(422).send(errors);
        return;
    }

    try{
        const existingMessage = await db.collection("messages").findOne({ _id: ObjectId(id) });

        if(!existingMessage){
            res.sendStatus(404);
            return;
        }

        if(from !== existingMessage.from){
            res.sendStatus(401);
            return;
        }

        await db.collection("messages").updateOne(
            { _id: ObjectId(id) },
            { $set: updatedMessage }
            );
        res.sendStatus(200);
    } catch (error) {
        console.log(error);
        res.sendStatus(500);
    }
})

server.listen(5000);
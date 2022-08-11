const amqp = require("amqplib");

const msg = {number: 19}
connect();
async function connect(){

    try{
        const connection = await amqp.connect("amqp://default_user_kiKqzdqlzatJ1pUDNJ-:ZXg_KM1hQUeTwvQqhDRJAIWECV0BLmRe@10.99.92.26:5672");
        const channel = await connection.createChannel();
        channel.sendToQueue("jobs",Buffer.from(JSON.stringify(msg)));
        console.log(`job sent111: ${msg}`)




    }
    catch (ex){
        console.error(ex);
    }
}
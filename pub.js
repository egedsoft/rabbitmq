//const amqp = require("amqplib");
const amqp = require("amqp-connection-manager");

const msg = {number: 19};
const queueName = 'jobs99bbb';


connect();
async function connect(){

    try{
        const connection = await amqp.connect(["amqp://appuser:apppassword1@10.99.92.26:5672/appvhost"]);
        const channel = await connection.createChannel();
        channel.checkQueue
        channel.assertQueue(queueName);
        channel.sendToQueue(queueName,Buffer.from(JSON.stringify(msg)));
        console.log(`job sent: ${msg.number}`); 
    }
    catch (ex){
        console.log ("---ERR---");
        console.error(ex);
    }
}
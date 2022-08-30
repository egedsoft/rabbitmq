const amqp = require("amqplib");
//const amqp = require("amqp-connection-manager");

var msg = {number: 19};
const queueName = 'jobs99bbb';


connect();
async function connect(){

    try{
        console.log ("---START---");
        const connection = await amqp.connect("amqp://guest:guest@20.103.211.34:5672/");
        const channel = await connection.createChannel();
        for (let index = 0; index < 100; index++) {
            msg = {number: index};
            channel.assertQueue(queueName);
            channel.sendToQueue(queueName,Buffer.from(JSON.stringify(msg)));
            console.log(`job sent: ${msg.number}`); 
        }
    }
    catch (ex){
        console.log ("---ERR---");
        console.error(ex);
    }
}
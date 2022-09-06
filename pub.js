const amqp = require("amqplib");
//const amqp = require("amqp-connection-manager");

var msg = {number: 19};
var queueName = 'queue-0';


connect();

function getRandomInt(max) {
    return Math.floor(Math.random() * max);
}

async function connect(){

    try{
        console.log ("---START---");
        const connection = await amqp.connect("amqp://guest:guest@10.99.92.31:5672/");
        channel = await connection.createChannel();
        var delete_q=false;
        channel.deleteQueue('aaa-reception-status-frame-delivered-to-globus_5-dlx');
        for (let index1 = 0; index1 < 400; index1++) {
            queueName = "queue-" + index1.toString();
            console.log(queueName);
           // channel.deleteQueue(queueName);
           // return;

            channel.assertQueue(queueName);
            await new Promise(r => setTimeout(r, 1000));
            channel.deleteQueue('aaa-reception-status-frame-delivered-to-globus');
            delete_q=getRandomInt(4);
            for (let index = 0; index < 2000000; index++) {
                msg = {number: index};
               // channel.publish('reception-status-frame-delivered-to-globus-exchange','',Buffer.from(JSON.stringify(msg)));
                channel.sendToQueue(queueName,Buffer.from(JSON.stringify(msg)));
                console.log(`job sent: ${msg.number}`); 
                await new Promise(r => setTimeout(r, 1));
            }
            
            if (delete_q===0){
                channel.deleteQueue(queueName);
                channel = await connection.createChannel();
                console.log(`-----Queue: ${queueName} deleted-----`); 
            }
        }
    }
    catch (ex){
        console.log ("---ERR---");
        console.error(ex);
    }
}
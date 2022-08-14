const amqp = require("amqplib");

const msg = {number: 19}
connect();
async function connect(){

    try{
        const connection = await amqp.connect("amqp://appuser:apppassword1@10.99.92.26:5672/appvhost");
        const channel = await connection.createChannel();
       // q_jobs1 = channel.checkQueue("jobs5");
        //console.log(q_jobs1.passive);
        channel.assertQueue("jobs5",{
            passive: true
        });
        channel.sendToQueue("jobs5",Buffer.from(JSON.stringify(msg)));
        console.log(`job sent111: ${msg}`)

        



    }
    catch (ex){
        console.error(ex);
    }
}
const amqplib = require('amqplib');

var amqp_url = process.env.CLOUDAMQP_URL || 'amqp://guest:guest@20.85.187.5:15672/';

async function do_consume() {
    var conn = await amqplib.connect(amqp_url, "heartbeat=60");
    var ch = await conn.createChannel()
    var q = 'qq-reception-status-frame-delivered-to-globus';
    await conn.createChannel();
    await ch.assertQueue(q, {durable: true});
    
    for (let index = 0; index < 200; index++) {

    await new Promise(r => setTimeout(r, 1));

        await ch.consume(q, function (msg) {
            console.log(msg.content.toString());
            
            ch.nack(msg);
           //  ch.ack(msg);
            ch.cancel('myconsumer');
            }, {consumerTag: 'myconsumer'});
    }


    setTimeout( function()  {
        ch.close();
        conn.close();},  1);
}

do_consume();
const amqp = require('amqp-connection-manager');
//const {wait} = require('../lib/helpers');

const msg = {number: 19};
const queueName = 'abc';
const EXCHANGE_NAME = 'amqp-connection-manager-sample2-ex';

// Create a connetion manager
const connection = amqp.connect(['amqp://appuser:apppassword1@10.99.92.26:5672/appvhost']);
connection.on('connect', () => console.log('Connected!'));
connection.on('disconnect', err => console.log('Disconnected.', err.stack));

// Create a channel wrapper
const channelWrapper = connection.createChannel({
    json: true,
    setup: channel => channel.checkQueue(queueName)
   // setup: channel => channel.assertQueue(queueName, { passive: true })

  //  setup: channel => channel.assertExchange(EXCHANGE_NAME, 'topic',{ passive: true }),

});


// Send messages until someone hits CTRL-C or something goes wrong...
function sendMessage() {
    channelWrapper.sendToQueue(queueName,Buffer.from(JSON.stringify(msg)))
  //  channelWrapper.publish(EXCHANGE_NAME, "test", {time: Date.now()}, { contentType: 'application/json', persistent: true })
    .then(function() {
        console.log("Message sent");
        return 'aa'; //wait(1000);
    })
    .then(() => sendMessage())
    .catch(err => {
        console.log("Message was rejected:", err.stack);
        channelWrapper.close();
        connection.close();
    });
};

console.log("Sending messages...");
sendMessage();
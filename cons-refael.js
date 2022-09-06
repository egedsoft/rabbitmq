const amqp = require('amqp-connection-manager');

const QUEUE_NAME = 'queue-0'
const EXCHANGE_NAME = 'amqp-connection-manager-sample2-ex';

// Handle an incomming message.
var onMessage = function(data) {
    var message = JSON.parse(data.content.toString());
    console.log("receiver: got message", message);
    channelWrapper.ack(data);
}

// Create a connetion manager
var connection = amqp.connect(['amqp://guest:guest@10.99.92.31:5672/'],
{ 
    clientProperties: 
    { 
        applicationName: 'myApplication', 
        capabilities: 
        { 
            consumer_cancel_notify: true
        }
    }
});

connection.on('connect', function() {
    console.log('Connected!');
});
connection.on('disconnect', function(err) {
    console.log('Disconnected.', err.stack);
});

// Set up a channel listening for messages in the queue.
var channelWrapper = connection.createChannel({
    setup: function(channel) {
        // `channel` here is a regular amqplib `ConfirmChannel`.
        return Promise.all([
            
            channel.assertQueue(QUEUE_NAME, {durable: true}),
            channel.prefetch(1),
            channel.consume(QUEUE_NAME, onMessage)
        ]);
    }
});

channelWrapper.waitForConnect()
.then(function() {
    console.log("Listening for messages");
});
const amqp = require('amqp-connection-manager');

const QUEUE_NAME = 'unroutable'
const EXCHANGE_NAME = 'amqp-connection-manager-sample2-ex';

// Handle an incomming message.
var onMessage = function(data) {
    var message = JSON.parse(data.content.toString());
    console.log("receiver: got message", message);
    channelWrapper.ack(data);
}

// Create a connetion manager
var connection = amqp.connect(['amqp://guest:guest@10.99.92.16:5672/'],
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

console.log (`connection status: ${connection.isConnected()}`);

// Set up a channel listening for messages in the queue.
var channelWrapper = connection.createChannel({
    setup: function(channel) {
        console.log (`aaaaaaaaaaaaaaa-----connection status: ${connection.isConnected()}`);       
        // `channel` here is a regular amqplib `ConfirmChannel`.
      //  console.log (`connection status: ${connection.isConnected}`);
        return Promise.all([
            
            channel.assertQueue(QUEUE_NAME, {durable: true}),
            channel.prefetch(1),
            channel.consume(QUEUE_NAME, msg => {
                messageString = msg.content.toString();
                messageString = msg.content.toString();
            })

        ]);

    }
});

channelWrapper.waitForConnect()
.then(function() {
    console.log("Listening for messages");
    console.log (`connection status: ${connection.isConnected()}`);
});
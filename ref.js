const amqp = require('amqp-connection-manager');
//const {wait} = require('../lib/helpers');


const connectionString = 'amqp://appuser:apppassword1@10.99.92.26:5672/appvhost';
const msg = {number: 19};
const queueName = 'q-test-1';
const EXCHANGE_NAME = 'ex-test-12';



// Create a new connection manager
var connection = amqp.connect([connectionString]);

// Ask the connection manager for a ChannelWrapper.  Specify a setup function to
// run every time we reconnect to the broker.
var channelWrapper = connection.createChannel({
  json: true,
  setup: function (channel) {
    // `channel` here is a regular amqplib `ConfirmChannel`.
    // Note that `this` here is the channelWrapper instance.
     res =  channel.checkQueue(queueName);
    return res;
    return channel.assertQueue(queueName, { durable: true, passive: true });
  },
});

// Send some messages to the queue.  If we're not currently connected, these will be queued up in memory
// until we connect.  Note that `sendToQueue()` and `publish()` return a Promise which is fulfilled or rejected
// when the message is actually sent (or not sent.)
//res =  channelWrapper.checkQueue(queueName);
channelWrapper
  .sendToQueue(queueName, { hello: 'world' })
  .then(function () {
    return console.log('Message was sent!  Hooray!');
  })
  .catch(function (err) {
    return console.log('Message was rejected...  Boo!');
  });
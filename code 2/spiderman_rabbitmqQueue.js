const amqplib = require("amqp-connection-manager");
const Queue = require("./queue");
const _ = require("lodash");
const { promiseValues } = require("../utils");
const createConsumeChannelWrappers = require("./channels/consumers");
const createPublishChannelWrappers = require("./channels/publishers");

module.exports = class RabbitmqQueue extends Queue {
  constructor(logger, config) {
    super(logger, config);
    this._exchangeNameToConsumeChannelMap = {};
    this._exchangeNameToPublishChannelMap = {};
    this._consumeChannelWrappers = createConsumeChannelWrappers(this, logger);
    this._publishChannelWrappers = createPublishChannelWrappers(this, logger);
  }

  async init() {
    this._consumeConnection = await amqplib.connect(
      this._config.connectionStrings,
      { heartbeatIntervalInSeconds: this._config.heartbeatInterval }
    );
    await this._registerConsumeConnectionEvents(this._consumeConnection);

    this._publishConnection = await amqplib.connect(
      this._config.connectionStrings,
      { heartbeatIntervalInSeconds: this._config.heartbeatInterval }
    );
    await this._registerPublishConnectionEvents(this._publishConnection);
  }

  async _registerConsumeConnectionEvents(connection) {
    connection.on("connect", async () => {
      try {
        this._lastConnectTime = new Date();
        await this._createAndConnectAllConsumeChannels();
        this._logger.log("info", "Rabbit mq connected for consumers!");
      } catch (err) {
        this._logger.log("error", `Error in creating consume channels. Will disconnect and reconnect, error: ${JSON.stringify(err)}`);
        this._consumeConnection._currentConnection.connection.close();
      }
    });

    connection.on("disconnect", (err) => {
      if (err.err) {
        err = err.err;
      }
      this._logger.log("error", `Rabbit mq disconnected for consumers. error: ${err.stack || err.message || err} , error object: ${JSON.stringify(err)}`);
      this._closeConsumeChannels();
    });
  }

  async _registerPublishConnectionEvents(connection) {
    connection.on("connect", async () => {
      try {
        await this._createAndConnectAllPublishChannels();
        this._logger.log("info", "Rabbit mq connected for publishers!");
      } catch (err) {
        this._logger.log("error", `Error in creating publish channels. Will disconnect and reconnect, error: ${JSON.stringify(err)}`);
        this._publishConnection._currentConnection.connection.close();
      }
    });

    connection.on("disconnect", (err) => {
      if (err.err) {
        err = err.err;
      }
      this._logger.log("error", `Rabbit mq disconnected for publishers. error: ${err.stack || err.message || err} , error object: ${JSON.stringify(err)}`);
      this._closePublishChannels();
    });
  }

  async _createAndConnectAllConsumeChannels() {
    this._exchangeNameToConsumeChannelMap = await promiseValues(
      this._consumeChannelWrappers.reduce(
        (newObj, channelWrapper) =>
          Object.assign(newObj, {
            [channelWrapper.channelConfig.exchangeName]:
              channelWrapper.initChannel(this._consumeConnection),
          }),
        {}
      )
    );
  }

  async _createAndConnectAllPublishChannels() {
    this._exchangeNameToPublishChannelMap = await promiseValues(
      this._publishChannelWrappers.reduce(
        (newObj, channelWrapper) =>
          Object.assign(newObj, {
            [channelWrapper.channelConfig.exchangeName]:
              channelWrapper.initChannel(this._publishConnection),
          }),
        {}
      )
    );
  }

  async _closeConsumeChannels() {
    try {
      await Promise.all(
        _.map(
          Object.keys(this._exchangeNameToConsumeChannelMap),
          (channelName) => this._closeConsumeChannelByName(channelName)
        )
      );
    } catch (err) {
      this._logger.log("error", `Closing channel err ${err.message}`);
    } finally {
      this._exchangeNameToConsumeChannelMap = {};
    }
  }

  async _closePublishChannels() {
    try {
      await Promise.all(
        _.map(
          Object.keys(this._exchangeNameToPublishChannelMap),
          (channelName) => this._closePublishChannelByName(channelName)
        )
      );
    } catch (err) {
      this._logger.log("error", `Closing channel err ${err.message}`);
    } finally {
      this._exchangeNameToPublishChannelMap = {};
    }
  }

  async _closeConsumeChannelByName(channelName) {
    this._logger.log("info", `Closing channel of ${channelName}`);
    await this._exchangeNameToConsumeChannelMap[channelName].close();
    delete this._exchangeNameToConsumeChannelMap[channelName];
  }

  async _closePublishChannelByName(channelName) {
    this._logger.log("info", `Closing channel of ${channelName}`);
    await this._exchangeNameToPublishChannelMap[channelName].close();
    delete this._exchangeNameToPublishChannelMap[channelName];
  }

  _ack(channel, msg, time) {
    if (time < this._lastConnectTime) {
      this._logger.log(
        "warn",
        `Can't ack - message ${msg.content.toString()} dismissed because the channel reconnected since consumption`
      );
      return;
    }

    channel.ack(msg);
  }

  _nack(channel, msg, time) {
    if (time < this._lastConnectTime) {
      this._logger.log(
        "warn",
        `Can't ack - message ${msg.content.toString()} dismissed because the channel reconnected since consumption`
      );
      return;
    }

    channel.nack(msg, false, false);
  }

  ackByQueueName(queueName, msg, time) {
    this._ack(this._getConsumeChannelByQueueName(queueName), msg, time);
  }

  nackByQueueName(queueName, msg, time) {
    this._nack(this._getConsumeChannelByQueueName(queueName), msg, time);
  }

  _getConsumeChannelByQueueName(queueName) {
    const exchangeName = _.chain(this._consumeChannelWrappers)
      .find((wrapper) => wrapper.channelConfig.qName === queueName)
      .get("channelConfig.exchangeName", "")
      .value();
    return this._getConsumeChannelByExchangeName(exchangeName);
  }

  _getPublishChannelByQueueName(queueName) {
    const exchangeName = _.chain(this._publishChannelWrappers)
      .find((wrapper) => wrapper.channelConfig.qName === queueName)
      .get("channelConfig.exchangeName", "")
      .value();
    return this._getPublishChannelByExchangeName(exchangeName);
  }

  _getConsumeChannelByExchangeName(exchangeName) {
    if (!this._exchangeNameToConsumeChannelMap[exchangeName]) {
      throw new Error(`Channel for ${exchangeName} does not exist`);
    }

    return this._exchangeNameToConsumeChannelMap[exchangeName];
  }

  _getPublishChannelByExchangeName(exchangeName) {
    if (!this._exchangeNameToPublishChannelMap[exchangeName]) {
      throw new Error(`Channel for ${exchangeName} does not exist`);
    }

    return this._exchangeNameToPublishChannelMap[exchangeName];
  }

  async enqueue(qName, data) {
    this._logger.log("info", `Enqueueing to ${qName}`);
    await this._getPublishChannelByQueueName(qName).sendToQueue(qName, data);
    this._logger.log(
      "debug",
      `Enqueued ${JSON.stringify(data)} to queue ${qName}`
    );
  }

  async publish({ exchangeName, routingKey = "", data }) {
    const publishMessage = `Publishing to ${exchangeName} ${
      routingKey ? "with routing key " + routingKey : ""
    }`;
    this._logger.log("info", publishMessage);
    await this._getPublishChannelByExchangeName(exchangeName).publish(
      exchangeName,
      routingKey,
      data
    );
    this._logger.log(
      "debug",
      `Published ${JSON.stringify(data)} to exchange ${exchangeName}`
    );
  }
};

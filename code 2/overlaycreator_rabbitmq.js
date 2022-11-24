"use strict";

const amqplib = require("amqp-connection-manager");
const PubSub = require('../services/pubSub');

module.exports = class RabbitmqHandler extends PubSub {
    constructor(logger, config, cache, tracer) {
        super(logger, config, cache, tracer);
        this._overlayCreatorSetting = this.createQSetting(config.overlayCreator, true);
        this._closeScanSetting = this.createQSetting(config.closeScan, true);
        this._frameArrivedSetting = this.createQSetting(config.frameArrived, true);
        this._solutionResultSetting = this.createQSetting(config.solutionResult, true);
        this._mosaicResultSetting = this.createQSetting(config.mosaicResult, true);
        this._bulkerJobSetting = this.createQSetting(config.bulkerJob, false);
        this._fallbackSetting = this.createQSetting(config.fallback, false);
        this._heartbeatInterval = config.heartbeatInterval;
        this._allConsumeChannels = {};
        this._allPublishChannels = {};
    }

    async init() {
        this._consumeConnection = await amqplib.connect(this._config.connectionStrings,
            {heartbeatIntervalInSeconds: this._heartbeatInterval});
        this._consumeConnection.on("connect", async () => {
            this._lastConnectTime = new Date();
            await this.createAndConnectAllConsumeChannels();
            this._logger.log("info", "Rabbit mq connected for consumers!");
        });
        this._consumeConnection.on("disconnect", err => {
            if (err.err) {
                err = err.err;
            }
            this._logger.log("error", `Rabbit mq disconnected for consumers. error: ${err.stack || err.message || err} , error object: ${JSON.stringify(err)}`);
            this.closeConsumeChannels();
        });

        this._publishConnection = await amqplib.connect(this._config.connectionStrings,
            {heartbeatIntervalInSeconds: this._heartbeatInterval});
        this._publishConnection.on("connect", async () => {
            await this.createAndConnectAllPublishChannels();
            this._logger.log("info", "Rabbit mq connected for publishers!");
        });
        this._publishConnection.on("disconnect", err => {
            if (err.err) {
                err = err.err;
            }
            this._logger.log("error", `Rabbit mq disconnected for publishers. error: ${err.stack || err.message || err} , error object: ${JSON.stringify(err)}`);
            this.closePublishChannels();
        });
    }

    async createAndConnectAllConsumeChannels() {
        try {
            this._overlayCreatorChannelWrapper = await this.createChannelAndConnect(this._overlayCreatorSetting, this._consumeConnection);
            this._closeScanChannelWrapper = await this.createChannelAndConnect(this._closeScanSetting, this._consumeConnection);
            this._frameArrivedChannelWrapper = await this.createChannelAndConnect(this._frameArrivedSetting, this._consumeConnection);
            this._solutionResultChannelWrapper = await this.createChannelAndConnect(this._solutionResultSetting, this._consumeConnection);
            this._mosaicResultChannelWrapper = await this.createChannelAndConnect(this._mosaicResultSetting, this._consumeConnection);

            this._allConsumeChannels = {
                ['overlayCreatorChannel']: this._overlayCreatorChannelWrapper,
                ['closeScanChannel']: this._closeScanChannelWrapper,
                ['frameArrivedChannel']: this._frameArrivedChannelWrapper,
                ['solutionResultChannel']: this._solutionResultChannelWrapper,
                ['mosaicResultChannel']: this._mosaicResultChannelWrapper
            };
        } catch (e) {
            this._logger.log('error', `Error in creating consume channels. Will disconnect and reconnect, error: ${JSON.stringify(e)}`);
            this._consumeConnection._currentConnection.connection.close();
        }
    }

    async createAndConnectAllPublishChannels() {
        try {
            this._bulkerJobChannelWrapper = await this.createChannelAndConnect(this._bulkerJobSetting, this._publishConnection);
            this._fallbackChannelWrapper = await this.createChannelAndConnect(this._fallbackSetting, this._publishConnection);
            this._exchangesChannelWrapper = await this.createExchangesChannelAndConnect(this.getPublishExchangeNames());

            this._allPublishChannels = {
                ['bulkerJobChannel']: this._bulkerJobChannelWrapper,
                ['fallbackChannel']: this._fallbackChannelWrapper,
                ['exchangesChannel']: this._exchangesChannelWrapper
            };
        } catch (e) {
            this._logger.log('error', `Error in creating publish channels. Will disconnect and reconnect, error: ${JSON.stringify(e)}`);
            this._publishConnection._currentConnection.connection.close();
        }
    }

    getPublishExchangeNames() {
        return [
            this._config.overlayCreated.exchangeName,
            this._config.overlayCreated.failureExchangeName,
            this._config.overlayCreatedWithMosaic.exchangeName,
            this._config.overlayCreatedWithMosaic.failureExchangeName
        ];
    }

    async closeConsumeChannels() {
        await Promise.all(Object.keys(this._allConsumeChannels).map(async channelName => {
            this._logger.log(
                'info',
                `Closing channel of ${channelName}`
            );
            await this._allConsumeChannels[channelName].close();
            delete this._allConsumeChannels[channelName];
        }));
    }

    async closePublishChannels() {
        await Promise.all(Object.keys(this._allPublishChannels).map(async channelName => {
            this._logger.log(
                'info',
                `Closing channel of ${channelName}`
            );
            await this._allPublishChannels[channelName].close();
            delete this._allPublishChannels[channelName];
        }));
    }

    createQSetting(qSettings, isConsumer = false) {
        let ttl = parseInt(qSettings.qTTL);
        let dlxQName = qSettings.qName ? `${qSettings.qName}_${ttl}-dlx` : "";
        return Object.assign({},
            { qTTL: ttl },
            qSettings.qName ? { qName: qSettings.qName } : null,
            { qExchangeName: qSettings.qExchangeName ? qSettings.qExchangeName : `${qSettings.qName}_${ttl}-exchange` },
            qSettings.qName ? { dlxQName: dlxQName } : null,
            qSettings.qName ? { dlxQExchangeName: `${dlxQName}_${ttl}-exchange` } : null,
            { isConsumer: isConsumer },
            isConsumer ? { parallelTasks: qSettings.parallelTasks ? parseInt(qSettings.parallelTasks) : 1 } : null,
            { qExchangeType: (qSettings.type) ? qSettings.type : "direct" },
            (qSettings.routingKeys) ? { routingKeys: qSettings.routingKeys } : null,
        );
    }

    async createChannelAndConnect(settings, connection) {
        try {
            let channelWrapper = connection.createChannel({
                json: true,
                setup: async (channel) => {
                    await channel.assertExchange(settings.qExchangeName, settings.qExchangeType, {
                        durable: true
                    })
                    if (settings.isConsumer) {

                        let privateExchangeName = `${settings.qName}-exchange`;
                        await channel.assertExchange(privateExchangeName, "fanout", {
                            durable: true
                        });

                        await channel.assertQueue(settings.qName, {
                            durable: true,
                            deadLetterExchange: settings.dlxQExchangeName
                        });

                        if (!settings.routingKeys) {
                            await channel.bindQueue(settings.qName, settings.qExchangeName);
                        } else {
                            for (let routingKey of settings.routingKeys) {
                                await channel.bindQueue(settings.qName, settings.qExchangeName, routingKey);
                            }
                        }
                        await channel.bindQueue(settings.qName, privateExchangeName);

                        await channel.assertExchange(settings.dlxQExchangeName, "fanout", {
                            durable: true
                        });

                        await channel.assertQueue(settings.dlxQName, {
                            durable: true,
                            deadLetterExchange: privateExchangeName,
                            messageTtl: settings.qTTL * 1000
                        });
                        await channel.bindQueue(settings.dlxQName, settings.dlxQExchangeName);

                        await channel.prefetch(settings.parallelTasks);
                        await channel.consume(settings.qName, msg => this.emit(settings.qName, {msg, msgTime: new Date()}))
                    }
                }
            });
            await channelWrapper.waitForConnect();
            if (!settings.isConsumer) {
                this._logger.log("info", `Done config exchange : ${settings.qExchangeName}`);
            } else {
                this._logger.log("info", `Done config queue : ${settings.qName}`);
            }
            return channelWrapper;
        } catch (e) {
            this._logger.log('error', `Error in createChannelAndConnect : ${e.message || e}`);
        }
    }

    async createExchangesChannelAndConnect(exchangeNames) {
        let channelWrapper = this._publishConnection.createChannel({
            json: true,
            setup: channel => {
                let actionsP = [];
                for (let exchangeName of exchangeNames) {
                    actionsP.push(channel.assertExchange(exchangeName, "fanout", {
                        durable: true
                    }));
                }
                return Promise.all(actionsP);
            }
        });
        await channelWrapper.waitForConnect();
        this._logger.log("info", `Done config exchanges : ${exchangeNames}`);
        return channelWrapper;
    }

    ackByType(type, msg, time) {
        if (time < this._lastConnectTime) {
            this._logger.log("warn", `Can't ack - message ${msg.content.toString()} dismissed because the channel reconnected since consumption`);
            return;
        }

        if (type === "overlayCreator") {
            this.ack(this._overlayCreatorChannelWrapper, msg);
        } else if (type === "frameArrived") {
            this.ack(this._frameArrivedChannelWrapper, msg);
        } else if (type === "solutionResult") {
            this.ack(this._solutionResultChannelWrapper, msg);
        } else if (type === "mosaicResult") {
            this.ack(this._mosaicResultChannelWrapper, msg);
        } else if (type === "closeScan") {
            this.ack(this._closeScanChannelWrapper, msg);
        } else {
            throw new Error(`Type ${type} not exist`);
        }
    }

    nackByType(type, msg, time) {
        if (time < this._lastConnectTime) {
            this._logger.log("warn", `Can't nack - message ${msg.content.toString()} dismissed because the channel reconnected since consumption`);
            return;
        }

        if (type === "overlayCreator") {
            this.nack(this._overlayCreatorChannelWrapper, msg);
        } else if (type === "frameArrived") {
            this.nack(this._frameArrivedChannelWrapper, msg);
        } else if (type === "solutionResult") {
            this.nack(this._solutionResultChannelWrapper, msg);
        } else if (type === "mosaicResult") {
            this.nack(this._mosaicResultChannelWrapper, msg);
        } else if (type === "closeScan") {
            this.nack(this._closeScanChannelWrapper, msg);
        } else {
            throw new Error(`Type ${type} not exist`);
        }
    }

    ack(channel, msg) {
        channel.ack(msg);
    }

    nack(channel, msg) {
        channel.nack(msg, false, false);
    }

    reject(channel, msg) {
        channel.reject(msg);
    }

    async enqueue(channel, qName, data) {
        await channel.sendToQueue(qName, data, { presistent: true });
    }

    async addOverlayCreatorJobDLX(job, span) {
        /**
         * Note:
         * Using _exchangesChannelWrapper here (and not _overlayCreatorChannelWrapper) is on purpose.
         * It is because we both consume and publish overlayCreator job messages,
         * and it's best practice to separate publish and consume to different connections.
         */
        await this.enqueue(this._exchangesChannelWrapper, this._overlayCreatorSetting.dlxQName, job);
    }

    async publish(channel, exchange, msg, routingKey) {
        return channel.publish(exchange, routingKey, msg);
    }

    async publishCloseScan(msg) {
        /**
         * Note:
         * Using _exchangesChannelWrapper here (and not _closeScanChannelWrapper) is on purpose.
         * It is because we both consume and publish close scan,
         * and it's best practice to separate publish and consume to different connections.
         */
        const publishResponse = await this.publish(this._exchangesChannelWrapper, this._closeScanSetting.qExchangeName, msg);
        this._logger.log("info", `publishCloseScan scanId ${msg.scanId} `);
        return publishResponse;
    }

    async publishFallback(msg) {
        const publishResponse = await this.publish(this._fallbackChannelWrapper, this._fallbackSetting.qExchangeName, msg);
        this._logger.log("info", `publishFallback overlayId ${msg.overlayId} `);
        return publishResponse;
    }

    async publishBulkJob(msg) {
        const publishResponse = await this.publish(this._bulkerJobChannelWrapper, this._bulkerJobSetting.qExchangeName, msg);
        this._logger.log("info", `publishBulkJob bulkId ${msg.id} `);
        return publishResponse;
    }

    async publishOverlayCreated(msg) {
        const publishResponse = await this.publish(this._exchangesChannelWrapper, this._config.overlayCreated.exchangeName, msg, '');
        this._logger.log("debug", `Rabbitmq publish OverlayCreated : ${JSON.stringify(msg)}`);
        return publishResponse;
    }

    async publishOverlayCreationFailed(msg) {
        const publishResponse = await this.publish(this._exchangesChannelWrapper, this._config.overlayCreated.failureExchangeName, msg, '');
        this._logger.log("debug", `Rabbitmq publish OverlayCreationFailed : ${JSON.stringify(msg)}`);
        return publishResponse;
    }

    async publishOverlayCreatedWithMosaic(msg) {
        const publishResponse = await this.publish(this._exchangesChannelWrapper, this._config.overlayCreatedWithMosaic.exchangeName, msg, '');
        this._logger.log("debug", `Rabbitmq publish OverlayCreatedWithMosaic : ${JSON.stringify(msg)}`);
        return publishResponse;
    }

    async publishOverlayCreationWithMosaicFailed(msg) {
        const publishResponse = await this.publish(this._exchangesChannelWrapper, this._config.overlayCreatedWithMosaic.failureExchangeName, msg, '');
        this._logger.log("debug", `Rabbitmq publish OverlayCreationWithMosaicFailed : ${JSON.stringify(msg)}`);
        return publishResponse;
    }
};

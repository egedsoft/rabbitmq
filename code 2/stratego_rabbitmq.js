"use strict";

const EventEmitter = require("events").EventEmitter;
const amqplib = require("amqp-connection-manager");
const uuid = require('uuid');

module.exports = class RabbitmqHandler extends EventEmitter {
    constructor(logger, config, cache) {
        super();
        this._logger = logger;
        this._config = config;
        this._cache = cache;
        this._frameQSetting = this.createQSetting(config.frame);
        this._solutionQSetting = this.createQSetting(config.solution);
        this._frameFilesQSetting = this.createQSetting(config.frameFiles);
        this._additionalImageQSetting = this.createQSetting(config.additionalImage);
        this._globalFileQSetting = this.createQSetting(config.globalFile);
        this._basicFrameQSetting = this.createQSetting(config.basicFrame);
        this._blockQSetting = this.createQSetting(config.block);
        this._blockFrameQSetting = this.createQSetting(config.blockFrame);
        this._isPublishEnabled = String(this._config.isPublishEnabled) == 'true';
        this._heartbeatInterval = config.heartbeatInterval;
        this._newFrameExchangeName = config.newFrameExchangeName;
        this._newFrameExtensionsExchangeName = config.newFrameExtensionsExchangeName;
        this._overlayCreatorFrameArrivedExchangeName = config.overlayCreatorFrameArrivedExchangeName;
        this._blockEnhancerExchangeName = config.blockEnhancerExchangeName;

        this._frameSavedToDbExchangeName = config.frameSavedToDb.exchangeName;
        this._frameSaveToDbFailureExchangeName = config.frameSavedToDb.failureExchangeName;
        this._solutionCreatedExchangeName = config.solutionCreated.exchangeName;
        this._solutionCreatedFailureExchangeName = config.solutionCreated.failureExchangeName;

        this._allConsumeChannels = {};
        this._allPublishChannels = {};
    }

    get isPublishEnabled() {
        return this._isPublishEnabled;
    }

    async init() {
        this._consumeConnection = await amqplib.connect(this._config.connectionStrings,
            { heartbeatIntervalInSeconds: this._heartbeatInterval });
        this._consumeConnection.on("connect", async () => {
            this._lastConnectTime = new Date();
            await this.createAndConnectAllConsumeChannels();
            this._logger.log("info", "Rabbit mq connected for consumers!");
        });
        this._consumeConnection.on("disconnect", err => {
            if (err.err) {
                err = err.err;
            }
            this._logger.log(
                "error",
                `Rabbit mq disconnected for consumers. error: ${err.stack || err.message || err} , error object: ${JSON.stringify(err)}`
            );
            this.closeConsumeChannels();
        });

        this._publishConnection = await amqplib.connect(this._config.connectionStrings,
            { heartbeatIntervalInSeconds: this._heartbeatInterval });
        this._publishConnection.on("connect", async () => {
            await this.createAndConnectAllPublishChannels();
            this._logger.log("info", "Rabbit mq connected for publishers!");
        });
        this._publishConnection.on("disconnect", err => {
            if (err.err) {
                err = err.err;
            }
            this._logger.log(
                "error",
                `Rabbit mq disconnected for publishers. error: ${err.stack || err.message || err} , error object: ${JSON.stringify(err)}`
            );
            this.closePublishChannels();
        });
    }

    async createAndConnectAllConsumeChannels() {
        try {
            this._frameChannelWrapper = await this.createConsumeChannelAndConnect(this._frameQSetting);
            this._solutionChannelWrapper = await this.createConsumeChannelAndConnect(this._solutionQSetting);
            this._frameFilesChannelWrapper = await this.createConsumeChannelAndConnect(this._frameFilesQSetting);
            this._additionalImageChannelWrapper = await this.createConsumeChannelAndConnect(this._additionalImageQSetting);
            this._globalFileChannelWrapper = await this.createConsumeChannelAndConnect(this._globalFileQSetting);
            this._basicFrameChannelWrapper = await this.createConsumeChannelAndConnect(this._basicFrameQSetting);
            this._blockChannelWrapper = await this.createConsumeChannelAndConnect(this._blockQSetting);
            this._blockFrameChannelWrapper = await this.createConsumeChannelAndConnect(this._blockFrameQSetting);

            this._frameChannelWrapper._channel.consume(this._frameQSetting.qName, msg => this.emit(this._frameQSetting.qName, { msg, msgTime: new Date() }));
            this._solutionChannelWrapper._channel.consume(this._solutionQSetting.qName, msg => this.emit(this._solutionQSetting.qName, { msg, msgTime: new Date() }));
            this._frameFilesChannelWrapper._channel.consume(this._frameFilesQSetting.qName, msg => this.emit(this._frameFilesQSetting.qName, { msg, msgTime: new Date() }));
            this._additionalImageChannelWrapper._channel.consume(this._additionalImageQSetting.qName, msg => this.emit(this._additionalImageQSetting.qName, { msg, msgTime: new Date() }));
            this._globalFileChannelWrapper._channel.consume(this._globalFileQSetting.qName, msg => this.emit(this._globalFileQSetting.qName, { msg, msgTime: new Date() }));
            this._basicFrameChannelWrapper._channel.consume(this._basicFrameQSetting.qName, msg => this.emit(this._basicFrameQSetting.qName, { msg, msgTime: new Date() }));
            this._blockChannelWrapper._channel.consume(this._blockQSetting.qName, msg => this.emit(this._blockQSetting.qName, { msg, msgTime: new Date() }));
            this._blockFrameChannelWrapper._channel.consume(this._blockFrameQSetting.qName, msg => this.emit(this._blockFrameQSetting.qName, { msg, msgTime: new Date() }));

            this._allConsumeChannels = {
                [this._frameQSetting.qName]: this._frameChannelWrapper,
                [this._solutionQSetting.qName]: this._solutionChannelWrapper,
                [this._frameFilesQSetting.qName]: this._frameFilesChannelWrapper,
                [this._additionalImageQSetting.qName]: this._additionalImageChannelWrapper,
                [this._globalFileQSetting.qName]: this._globalFileChannelWrapper,
                [this._basicFrameQSetting.qName]: this._basicFrameChannelWrapper,
                [this._blockQSetting.qName]: this._blockChannelWrapper,
                [this._blockFrameQSetting.qName]: this._blockFrameChannelWrapper
            };
        } catch (e) {
            this._logger.log('error', `Error in creating consume channels. Will disconnect and reconnect, error: ${JSON.stringify(e)}`);
            this._consumeConnection._currentConnection.connection.close();
        }
    }

    async createAndConnectAllPublishChannels() {
        try {
            if (this.isPublishEnabled) {
                this._channelExchangesWrapper = await this.createPublishChannelAndConnect([
                    [this._newFrameExchangeName, 'fanout'],
                    [this._newFrameExtensionsExchangeName, 'fanout'],
                    [this._overlayCreatorFrameArrivedExchangeName, 'topic'],
                    [this._frameSavedToDbExchangeName, 'fanout'],
                    [this._frameSaveToDbFailureExchangeName, 'fanout'],
                    [this._solutionCreatedExchangeName, 'fanout'],
                    [this._solutionCreatedFailureExchangeName, 'fanout'],
                    [this._blockEnhancerExchangeName, 'topic']
                ]);

                this._allPublishChannels = {
                    ['exchangesChannel']: this._channelExchangesWrapper
                };
            }
        } catch (e) {
            this._logger.log('error', `Error in creating publish channels. Will disconnect and reconnect, error: ${JSON.stringify(e)}`);
            this._publishConnection._currentConnection.connection.close();
        }
    }

    createQSetting(qSettings) {
        let ttl = parseInt(qSettings.qTTL);
        let dlxQName = `${qSettings.qName}_${ttl}-dlx`;
        return {
            qTTL: ttl,
            qName: qSettings.qName,
            qExchangeName: `${qSettings.qName}_${ttl}-exchange`,
            dlxQName: dlxQName,
            dlxQExchangeName: `${dlxQName}_${ttl}-exchange`,
            parallelTasks: parseInt(qSettings.parallelTasks)
        };
    }

    async createPublishChannelAndConnect(exchanges) {
        let actionsP = [];
        let channelWrapper = this._publishConnection.createChannel({
            json: true,
            setup: channel => {
                for (let exchange of exchanges) {
                    let exchangeName = exchange[0];
                    let type = exchange[1];
                    actionsP.push(channel.assertExchange(exchangeName, type, {
                        durable: true
                    }))
                }
                return Promise.all(actionsP);
            }
        });
        await channelWrapper.waitForConnect();
        this._logger.log("info", `Done config exchanges: ${JSON.stringify(exchanges)}`);
        return channelWrapper;
    }

    async createConsumeChannelAndConnect(settings) {
        let channelWrapper = this._consumeConnection.createChannel({
            json: true,
            setup: channel => {
                return Promise.all([
                    channel.assertExchange(settings.qExchangeName, "direct", {
                        durable: true
                    }),
                    channel.assertQueue(settings.qName, {
                        durable: true,
                        deadLetterExchange: settings.dlxQExchangeName,
                        deadLetterRoutingKey: ""
                    }),
                    channel.bindQueue(settings.qName, settings.qExchangeName),

                    channel.assertExchange(settings.dlxQExchangeName, "direct", {
                        durable: true
                    }),
                    channel.assertQueue(settings.dlxQName, {
                        durable: true,
                        deadLetterExchange: settings.qExchangeName,
                        deadLetterRoutingKey: "",
                        messageTtl: settings.qTTL * 1000
                    }),
                    channel.bindQueue(settings.dlxQName, settings.dlxQExchangeName),
                    channel.prefetch(settings.parallelTasks)
                ]);
            }
        });
        await channelWrapper.waitForConnect();
        this._logger.log("info", `Done config queue : ${settings.qName}`);
        return channelWrapper;
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

    ack(channel, msg) {
        channel.ack(msg);
    }

    nack(channel, msg) {
        channel.nack(msg, false, false);
    }

    reject(channel, msg) {
        channel.reject(msg);
    }

    ackByType(type, msg, time) {
        if (time < this._lastConnectTime) {
            this._logger.log("warn", `Can't ack - message ${msg.content.toString()} dismissed because the channel reconnected since consumption`);
            return;
        }

        switch (type) {
            case "frame":
                this.ack(this._frameChannelWrapper, msg);
                break;
            case "solution":
                this.ack(this._solutionChannelWrapper, msg);
                break;
            case "frameFiles":
                this.ack(this._frameFilesChannelWrapper, msg);
                break;
            case "additionalImage":
                this.ack(this._additionalImageChannelWrapper, msg);
                break;
            case "globalFile":
                this.ack(this._globalFileChannelWrapper, msg);
                break;
            case "basicFrame":
                this.ack(this._basicFrameChannelWrapper, msg);
                break;
            case "block":
                this.ack(this._blockChannelWrapper, msg);
                break;
            case "blockFrame":
                this.ack(this._blockFrameChannelWrapper, msg);
                break;
            default:
                throw new Error(`Type ${type} not exist`);
        }
    }

    nackByType(type, msg, time) {
        if (time < this._lastConnectTime) {
            this._logger.log("warn", `Can't nack - message ${msg.content.toString()} dismissed because the channel reconnected since consumption`);
            return;
        }

        switch (type) {
            case "frame":
                this.nack(this._frameChannelWrapper, msg);
                break;
            case "solution":
                this.nack(this._solutionChannelWrapper, msg);
                break;
            case "frameFiles":
                this.nack(this._frameFilesChannelWrapper, msg);
                break;
            case "additionalImage":
                this.nack(this._additionalImageChannelWrapper, msg);
                break;
            case "globalFile":
                this.nack(this._globalFileChannelWrapper, msg);
                break;
            case "basicFrame":
                this.nack(this._basicFrameChannelWrapper, msg);
                break;
            case "block":
                this.nack(this._blockChannelWrapper, msg);
                break;
            case "blockFrame":
                this.nack(this._blockFrameChannelWrapper, msg);
                break;
            default:
                throw new Error(`Type ${type} not exist`);
        }
    }

    async publish(channel, exchange, msg, routingKey = '') {
        return channel.publish(exchange, routingKey, msg);
    }

    async publishFrame(frame) {
        this._logger.log("debug", `Rabbitmq publish frame : ${frame.id}`);
        return this.publish(this._channelExchangesWrapper, this._newFrameExchangeName, frame);
    }

    async publishFrameExtensions(frameExtensions) {
        this._logger.log("debug", `Rabbitmq publish ${frameExtensions.length} frameExtensions`);
        for (let frameExtension of frameExtensions) {
            this._logger.log("debug", `Rabbitmq publish frameExtension :  ${JSON.stringify(frameExtensions)}`);
            await this.publish(this._channelExchangesWrapper, this._newFrameExtensionsExchangeName, frameExtension);
        }
    }

    async publishFrameSavedToDb(msg) {
        this._logger.log("debug", `Rabbitmq publish FrameSavedToDb : ${JSON.stringify(msg)}`);
        return this.publish(this._channelExchangesWrapper, this._frameSavedToDbExchangeName, msg);
    }

    async publishFrameSaveToDbFailed(msg) {
        this._logger.log("debug", `Rabbitmq publish FrameSaveToDbFailed : ${JSON.stringify(msg)}`);
        return this.publish(this._channelExchangesWrapper, this._frameSaveToDbFailureExchangeName, msg);
    }

    async publishSolutionCreated(msg) {
        this._logger.log("debug", `Rabbitmq publish solutionCreated : ${JSON.stringify(msg)}`);
        return this.publish(this._channelExchangesWrapper, this._solutionCreatedExchangeName, msg);
    }

    async publishSolutionCreatedFailed(msg) {
        this._logger.log("debug", `Rabbitmq publish solutionCreatedFailed : ${JSON.stringify(msg)}`);
        return this.publish(this._channelExchangesWrapper, this._solutionCreatedFailureExchangeName, msg);
    }

    async dynamicPushBl(obj, params, span = null) {
        if (span && params.spanId) {
            this._cache.saveSpan(span, `${params.spanId}_${obj.id}`);
        }
        let msg = {
            id: obj.id,
            msgId: uuid.v4()
        };
        let routingKey = params.routingKey;
        this._logger.log("debug", `Rabbitmq dynamicPushBl. routingKey=${routingKey} , msg=${JSON.stringify(msg)}`);
        return this.publish(this._channelExchangesWrapper, this._overlayCreatorFrameArrivedExchangeName, msg, routingKey);
    }

    async dynamicPushBlockEnhancer(obj, params, span = null) {
        if (span && params.spanId) {
            this._cache.saveSpan(span, `${params.spanId}_${obj.id}`);
        }

        const msg = {
            id: obj.id,
            blockId: obj.blockId,
            msgId: uuid.v4()
        }

        let routingKey = params.routingKey;
        this._logger.log("debug", `Rabbitmq dynamicPushBlockEnhancer. routingKey=${routingKey} , msg=${JSON.stringify(msg)}`);
        return this.publish(this._channelExchangesWrapper, this._blockEnhancerExchangeName, msg, routingKey);
    }

};

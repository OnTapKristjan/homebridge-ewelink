const ewelink = require('ewelink-api');
let Accessory, Service, Characteristic, UUIDGen;

module.exports = function(homebridge) {
    console.log("homebridge API version: " + homebridge.version);

    // Accessory must be created from PlatformAccessory Constructor
    Accessory = homebridge.platformAccessory;

    // Service and Characteristic are from hap-nodejs
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    UUIDGen = homebridge.hap.uuid;

    // For platform plugin to be considered as dynamic platform plugin,
    // registerPlatform(pluginName, platformName, constructor, dynamic), dynamic must be true
    homebridge.registerPlatform("homebridge-eWeLink", "eWeLink", eWeLink, true);
};

function eWeLink(log, config, api) {
    let platform = this;
    this.log = log;
    this.config = config;
    this.accessories = new Map();
    this.api = api;
    this.connection = new ewelink({
        email: this.config['email'],
        password: this.config['password'],
    });

    this.api.on('didFinishLaunching', this.registerDevices.bind(this));
}

eWeLink.prototype.registerDevices = function () {
    (async () => {
        const devices = await this.connection.getDevices();

        this.log('Found total of [%s] devices registered with eWeLink', devices.length);

        devices.forEach((device) => {
            this.log('[%s] registering %s %s', device.deviceid, device.brandName, device.productModel);
            let services = this.getDeviceServices(device);
            this.addAccessory(device, device.deviceid, services);
        });
    })();
};

eWeLink.prototype.getDeviceServices = function (device) {
    let services = {};
    services.switch = true;

    return services;
};

/**
 * @param {Accessory} accessory
 */
eWeLink.prototype.configureAccessory = function(accessory) {
    this.log(accessory.displayName, "Configure Accessory");

    (async () => {
        let device = this.connection.getDevice(accessory.context.deviceId);
        this.log('Device online: %s', device.online);
        accessory.updateReachability(device.online === 'true');
    })();

    for (let idx in accessory.services) {
        let service = accessory.services[idx];
        if (service.subtype === undefined) {
            continue;
        }
        let channel = service.subtype.substr(1);
        service.getCharacteristic(Characteristic.On)
            .on('set', this.setPowerState.bind(this, accessory, channel))
            .on('get', this.getPowerState.bind(this, accessory, channel));
    }

    this.accessories.set(accessory.context.deviceId, accessory);
};

eWeLink.prototype.setPowerState = function(accessory, channel, value, callback) {
    (async () => {
        let deviceId = accessory.context.deviceId;
        const status = await this.connection.setDevicePowerState(deviceId, value ? 'on' : 'off', channel);
        this.log('[%s][channel %s] set power state = %o', accessory.displayName, channel, status);
        callback();
    })();
};

/**
 * @param {Accessory} accessory
 * @param {int} channel
 * @param {Function} callback
 */
eWeLink.prototype.getPowerState = function(accessory, channel, callback) {
    (async () => {
        let deviceId = accessory.context.deviceId;
        const status = await this.connection.getDevicePowerState(deviceId, channel);
        this.log('[%s][channel %s] get power state = %o', accessory.displayName, channel, status);
        if (status.state === 'on') {
            callback(null, 1);
        } else {
            callback(null, 0);
        }
    })();
};

eWeLink.prototype.addAccessory = function(device, deviceId, services) {
    if (this.accessories.get(deviceId)) {
        this.log("[%s] is already registered", deviceId);
        return;
    }

    this.log("Add Accessory [%s]", device.name);
    let platform = this;
    let uuid;
    uuid = UUIDGen.generate(device.name);

    let newAccessory = new Accessory(device.name, uuid);
    newAccessory.context.deviceId = deviceId;
    newAccessory.context.apiKey = device.apikey;
    newAccessory.context.switches = 1;
    // newAccessory.context.channel = 0;
    newAccessory.reachable = device.online === 'true';

    (async () => {
        const result = await this.connection.getDeviceChannelCount(deviceId);
        newAccessory.context.switches = result.switchesAmount;
        for (let channel=1; channel < result.switchesAmount + 1; channel++) {
            let service = new Service.Switch(device.name, 'c' + channel);
            service.getCharacteristic(Characteristic.On)
                .on('set', function(value, callback) {
                    (async () => {
                        await this.connection.setDevicePowerState(deviceId, value ? 'on' : 'off', channel);
                        callback();
                    })();
                }.bind(this))
                .on('get', function(callback) {
                    (async () => {
                        const status = await this.connection.getDevicePowerState(deviceId, channel);
                        if (status.state === 'on') {
                            callback(null, 1);
                        } else {
                            callback(null, 0);
                        }
                    })();
                }.bind(this));

            platform.log('Adding service Service.Switch for [%s], channel [%s]', service.displayName, channel);
            newAccessory.addService(service);
        }
    })();

    newAccessory.on('identify', function(paired, callback) {
        platform.log(newAccessory.displayName, "Identify not supported");
        callback();
    });

    newAccessory.getService(Service.AccessoryInformation).setCharacteristic(Characteristic.SerialNumber, device.extra.extra.mac);
    newAccessory.getService(Service.AccessoryInformation).setCharacteristic(Characteristic.Manufacturer, device.productModel);
    newAccessory.getService(Service.AccessoryInformation).setCharacteristic(Characteristic.Model, device.extra.extra.model);
    newAccessory.getService(Service.AccessoryInformation).setCharacteristic(Characteristic.Identify, false);
    newAccessory.getService(Service.AccessoryInformation).setCharacteristic(Characteristic.FirmwareRevision, device.params.fwVersion);

    this.accessories.set(device.deviceid, newAccessory);
    this.api.registerPlatformAccessories("homebridge-eWeLink", "eWeLink", [newAccessory]);
};

eWeLink.prototype.removeAccessory = function(accessory) {
    this.log('Removing accessory [%s]', accessory.displayName);

    this.accessories.delete(accessory.context.deviceId);

    this.api.unregisterPlatformAccessories('homebridge-eWeLink',
        'eWeLink', [accessory]);
};

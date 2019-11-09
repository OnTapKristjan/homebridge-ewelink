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

    this.api.on('didFinishLaunching', this.registerDevices.bind(this));
}

eWeLink.prototype.registerDevices = function () {
    (async () => {
        const connection = new ewelink({
            email: this.config['email'],
            password: this.config['password'],
        });

        /* get all devices */
        const devices = await connection.getDevices();

        this.log('There are a total of [%s] devices registered', devices.length);

        devices.forEach((device) => {
            this.log('[%s] registering %s %s', device.deviceid, device.brandName, device.productModel);
            let services = this.getDeviceServices(device);
            this.addAccessory(connection, device, device.deviceid, services);
        });
    })();
};

eWeLink.prototype.getDeviceServices = function (device) {
    let services = {};
    services.switch = true;

    return services;
};

eWeLink.prototype.configureAccessory = function(accessory) {
    this.log(accessory.displayName, "Configure Accessory");
    var platform = this;

    // Set the accessory to reachable if plugin can currently process the accessory,
    // otherwise set to false and update the reachability later by invoking
    // accessory.updateReachability()
    accessory.reachable = true;

    accessory.on('identify', function(paired, callback) {
        platform.log(accessory.displayName, "Identify!!!");
        callback();
    });

    if (accessory.getService(Service.Lightbulb)) {
        accessory.getService(Service.Lightbulb)
            .getCharacteristic(Characteristic.On)
            .on('set', function(value, callback) {
                platform.log(accessory.displayName, "Light -> " + value);
                callback();
            });
    }

    this.accessories.set(accessory.context.deviceId, accessory);
};

eWeLink.prototype.addAccessory = function(connection, device, deviceId, services) {
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

    if (services.switch) {
        (async () => {
            const result = await connection.getDeviceChannelCount(deviceId);
            newAccessory.context.switches = result.switchesAmount;
            for (let channel=1; channel < result.switchesAmount + 1; channel++) {
                let service = new Service.Switch(device.name, 'c' + channel);
                service
                    .getCharacteristic(Characteristic.On)
                    .on('set', function(value, callback) {
                        (async () => {
                            await connection.toggleDevice(deviceId, channel);
                            callback();
                        })();
                    })
                    .on('get', function(callback) {
                        (async () => {
                            const status = await connection.getDevicePowerState(deviceId, channel);
                            if (status.state === 'on') {
                                callback(null, 1);
                            } else {
                                callback(null, 0);
                            }
                        })();
                    });

                platform.log('Adding service Service.Switch for [%s], channel [%s]', service.displayName, channel);
                newAccessory.addService(service);
            }
        })();
    }

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

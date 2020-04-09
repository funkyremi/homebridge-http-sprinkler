import get from "lodash/get";
import request from "request";
import pollingtoevent from "polling-to-event";

let Service, Characteristic;

module.exports = homebridge => {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  homebridge.registerAccessory(
    "homebridge-http-sprinkler",
    "HttpSprinkler",
    HttpSprinkler
  );
};

class HttpSprinkler {
  constructor(log, config) {
    this.log = log;

    this.name = config.name || "HTTP Sprinkler";
    this.icon = config.icon || 0;

    this.onUrl = config.onUrl;
    this.offUrl = config.offUrl;
    this.statusUrl = config.statusUrl;

    this.httpMethod = config.httpMethod || "GET";
    this.timeout = config.timeout || 5000;
    this.pollingInterval = config.pollingInterval || 3000;
    this.checkStatus = config.checkStatus || "no";

    this.jsonPath = config.jsonPath;
    this.onValue = config.onValue || "On";
    this.offValue = config.offValue || "Off";
    this.useTimer = config.useTimer || "no";
    this.defaultTime = config.defaultTime || 300;

    this.manufacturer = config.manufacturer || "goedh452";
    this.model = config.model || "homebridge-http-sprinkler";
    this.serial = config.serial || "homebridge-http-sprinkler";

    // Status Polling
    if (this.statusUrl && this.checkStatus === "polling") {
      const powerurl = this.statusUrl;
      const statusemitter = pollingtoevent(
        done => {
          this.httpRequest(
            powerurl,
            "",
            this.httpMethod,
            (error, response, body) => {
              if (error) {
                this.log("HTTP get status function failed: %s", error.message);
                try {
                  done(new Error("Network failure must not stop homebridge!"));
                } catch (err) {
                  this.log(err.message);
                }
              } else {
                done(null, body);
              }
            }
          );
        },
        {
          interval: this.pollingInterval,
          eventName: "statuspoll"
        }
      );

      statusemitter.on("statuspoll", responseBody => {
        if (this.onValue && this.offValue) {
          const status = get(json, JSON.parse(responseBody));
          if (status == this.onValue) {
            this.valveService
              .getCharacteristic(Characteristic.Active)
              .updateValue(1);

            this.valveService
              .getCharacteristic(Characteristic.InUse)
              .updateValue(1);
          }

          if (status == this.offValue) {
            this.valveService
              .getCharacteristic(Characteristic.InUse)
              .updateValue(0);

            this.valveService
              .getCharacteristic(Characteristic.Active)
              .updateValue(0);
          }
        }
      });
    }
  }
  httpRequest(url, body, method, callback) {
    request(
      {
        url: url,
        body: body,
        method: this.httpMethod,
        timeout: this.timeout,
        rejectUnauthorized: false
      },
      (error, response, responseBody) => {
        if (callback) {
          callback(error, response, responseBody);
        } else {
          this.log("callbackMethod not defined!");
        }
      }
    );
  }
  getPowerState(callback) {
    if (!this.statusUrl || !this.jsonPath || !this.offValue) {
      this.log("Ignoring request: Missing status properties in config.json.");
      callback(new Error("No status url defined."));
      return;
    }

    this.httpRequest(
      this.statusUrl,
      "",
      this.httpMethod,
      (error, response, responseBody) => {
        if (error) {
          this.log("HTTP get status function failed: %s", error.message);
          callback(error);
        } else {
          try {
            const status = get(json, JSON.parse(responseBody));
            if (status != this.offValue) {
              this.log(`${status} status received from ${url}`);
              callback(null, true);
            } else {
              this.log(`${status} status received from ${url}`);
              callback(null, false);
            }
          } catch (e) {
            this.log(`status retreiving failed from ${url}`);
            callback(null, false);
          }
        }
      }
    );
  }
  setPowerState(powerOn, callback) {
    let url;
    let inuse;

    if (!this.onUrl || !this.offUrl) {
      this.log("Ignoring request: No power url defined.");
      callback(new Error("No power url defined."));
      return;
    }

    if (powerOn) {
      url = this.onUrl;
      inuse = 1;
      this.log("Setting power state to on");
    } else {
      url = this.offUrl;
      inuse = 0;
      this.log("Setting power state to off");
    }

    this.httpRequest(url, "", this.httpMethod, error => {
      if (error) {
        this.log("HTTP set status function failed %s", error.message);
      }
    });
    this.log("HTTP power function succeeded!");
    this.valveService
      .getCharacteristic(Characteristic.InUse)
      .updateValue(inuse);

    callback();
  }
  setPowerStatePolling(powerOn, callback) {
    var url;
    var inuse;

    if (!this.onUrl || !this.offUrl) {
      this.log("Ignoring request: No power url defined.");
      callback(new Error("No power url defined."));
      return;
    }

    if (powerOn) {
      url = this.onUrl;
      inuse = 1;
      this.log("Setting power state to on");
    } else {
      url = this.offUrl;
      inuse = 0;
      this.log("Setting power state to off");
    }

    this.httpRequest(url, "", this.httpMethod, error => {
      if (error) {
        this.log("HTTP set status function failed %s", error.message);
      }
    });
    this.valveService
      .getCharacteristic(Characteristic.InUse)
      .updateValue(inuse);

    callback();
  }
  setDurationTime(data) {
    this.log("Valve Time Duration Set to: " + data.newValue + " seconds");

    if (this.valveService.getCharacteristic(Characteristic.InUse).value) {
      this.valveService
        .getCharacteristic(Characteristic.RemainingDuration)
        .updateValue(data.newValue);

      clearTimeout(this.valveService.timer);

      this.valveService.timer = setTimeout(() => {
        this.log("Valve Timer Expired. Shutting off Valve");
        this.valveService.getCharacteristic(Characteristic.Active).setValue(0);
      }, data.newValue * 1000);
    }
  }
  setRemainingTime(data) {
    if (data.newValue === 0) {
      this.valveService
        .getCharacteristic(Characteristic.RemainingDuration)
        .updateValue(0);
      clearTimeout(this.valveService.timer);
    } else if (data.newValue === 1) {
      const timer = this.valveService.getCharacteristic(
        Characteristic.SetDuration
      ).value;
      this.valveService
        .getCharacteristic(Characteristic.RemainingDuration)
        .updateValue(timer);

      this.log(
        `Turning Valve ${this.name} on with Timer set to: ${timer} seconds`
      );

      this.valveService.timer = setTimeout(() => {
        this.log("Valve Timer Expired. Shutting off Valve");

        this.valveService.getCharacteristic(Characteristic.Active).setValue(0);
      }, timer * 1000);
    }
  }
  getServices() {
    this.informationService = new Service.AccessoryInformation();

    this.informationService
      .setCharacteristic(Characteristic.Manufacturer, this.manufacturer)
      .setCharacteristic(Characteristic.Model, this.model)
      .setCharacteristic(Characteristic.SerialNumber, this.serial);

    this.valveService = new Service.Valve(this.name);

    this.valveService
      .getCharacteristic(Characteristic.ValveType)
      .updateValue(this.icon);

    if (this.checkStatus === "once") {
      //Status polling
      this.log("Check status: once");
      let powerState = this.getPowerState;
      let powerStateInt = 0;

      this.valveService
        .getCharacteristic(Characteristic.Active)
        .on("set", this.setPowerState)
        .on("get", powerState);

      if (powerState) {
        powerStateInt = 1;
      } else {
        powerStateInt = 0;
      }

      this.valveService
        .getCharacteristic(Characteristic.InUse)
        .updateValue(powerStateInt);
    } else if (this.checkStatus === "polling") {
      this.log("Check status: polling");
      this.valveService
        .getCharacteristic(Characteristic.Active)
        .on("get", callback => {
          callback(null, false);
        })
        .on("set", this.setPowerStatePolling);
    } else {
      this.log("Check status: default");
      this.valveService
        .getCharacteristic(Characteristic.Active)
        .on("set", this.setPowerState);
    }

    if (this.useTimer == "yes") {
      this.valveService.addCharacteristic(Characteristic.SetDuration);
      this.valveService.addCharacteristic(Characteristic.RemainingDuration);

      // Set initial runtime from config
      this.valveService
        .getCharacteristic(Characteristic.SetDuration)
        .setValue(this.defaultTime);

      this.valveService
        .getCharacteristic(Characteristic.SetDuration)
        .on("change", this.setDurationTime);

      this.valveService
        .getCharacteristic(Characteristic.RemainingDuration)
        .on("change", data => {
          this.log("Valve Remaining Duration changed to: " + data.newValue);
        });

      this.valveService
        .getCharacteristic(Characteristic.InUse)
        .on("change", this.setRemainingTime);
    }
    return [this.valveService, this.informationService];
  }
}

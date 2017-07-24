let Insteon = require('home-controller').Insteon;
let mqtt = require('mqtt')
let nconf = require('nconf');

nconf.file(__dirname + '/config.json');
let lights = nconf.get('lights');
let doors = nconf.get('doors');
const hubConfig = nconf.get('hub');
const mqttBroker = nconf.get('mqtt:url');
const mqttOpts = nconf.get('mqtt:options');

let hub = new Insteon();
let mqttClient;
let updateLinksInterval;

const setupLinks = () => {
  hub.links( function(error, links) {
    links.forEach((link) => {
      if (link.data[0] == '03') { // dimmers
        let light = hub.light(link.id);
        lights[light.id] = lights[light.id] || {}
        const lightName = lights[light.id].name || light.id + ' Dimmer';
        const deviceConfig = {
          name: lightName,
          platform: 'mqtt_json',
          brightness: true,
          state_topic: `homelights/${light.id}/state`,
          command_topic: `homelights/${light.id}/state/set`,
        }
        mqttClient.publish(`homeassistant/light/${light.id}/config`, JSON.stringify(deviceConfig));
        mqttClient.subscribe(`homelights/${light.id}/state/set`);
        
        const updateLightState = () => {
          hub.light(light.id).level( (err, curLevel) => {
            setTimeout(() => {
              hub.light(light.id).level( (err, curLevel2) => {
                if (curLevel !== curLevel2) return updateLightState();
                lights[light.id] = lights[light.id] || {};
                if (curLevel > 0) {
                  lights[light.id].lastLevel = curLevel * 2.55;
                }
                const deviceState = {
                  state: (curLevel > 0 ? 'ON' : 'OFF'),
                  brightness: Math.round(curLevel * 2.55),
                }
                mqttClient.publish(`homelights/${light.id}/state`, JSON.stringify(deviceState));
                console.log(`${lightName}: `, deviceState);
              });
            }, 500);
          });
        }
        updateLightState();
        if (!lights[light.id].bound) {
          lights[light.id].bound = true;
          light.on('turnOn', updateLightState);
          light.on('turnOff', updateLightState);
          light.on('turnOnFast', updateLightState);
          light.on('turnOffFast', updateLightState);
          light.on('brightened', updateLightState);
          light.on('dimmed', updateLightState);
        }
      }
    });
  });
}

const setupMqtt = () => {
  mqttClient  = mqtt.connect(mqttBroker, mqttOpts);
  mqttClient.on("error", function(err) {
    console.log("MQTT::Error from client --> ", err);
  })
  mqttClient.on("connect", function() {
    console.log("MQTT::Connected");
    setupLinks()
    if (updateLinksInterval) {
      clearInterval(updateLinksInterval);
    }
    updateLinksInterval = setInterval(setupLinks, 300000);
  })
  mqttClient.on("message", function (topic, rawMsg) {
    let msg = JSON.parse(rawMsg);
    console.log(topic, msg);
    const lightIdRes = topic.match(/homelights\/(.+)\/state\/set/);
    if (lightIdRes[1]) {
      const lightId = lightIdRes[1];
      let deviceState;
      if (msg.state == 'OFF' || msg.brightness === 0) {
        deviceState = {
          state: 'OFF',
        }
      } else if (msg.brightness || lights[lightId].lastLevel) {
        const lightBrightness = Math.round(msg.brightness || lights[lightId].lastLevel);
        deviceState = {
          state: 'ON',
          brightness: lightBrightness,
        }
        lights[lightId].lastLevel = lightBrightness;
      } else {
        deviceState = {
          state: 'ON',
        } 
      }
      // optimistic update
      mqttClient.publish(`homelights/${lightId}/state`, JSON.stringify(deviceState));
      console.log(`${lightId} optimistic: `, deviceState);
      if (deviceState.state == 'OFF') {
        hub.light(lightId).turnOff();
      } else {
        const lightBrightness = deviceState.brightness ? Math.round(deviceState.brightness / 2.55) : null;
        hub.light(lightId).turnOn(lightBrightness);
      }
    }
  })
}

const setupDoor = (doorId) => {
  const doorConfig = doors[doorId];
  let door = hub.door(doorId)
  const deviceConfig = {
    name: doorConfig.name,
    device_class: 'opening',
  };
  const registerDevice = (state) => {
    mqttClient.publish(`homeassistant/binary_sensor/${door.id}/config`, JSON.stringify(deviceConfig));
    setTimeout(() => {
      mqttClient.publish(`homeassistant/binary_sensor/${door.id}/state`, state);
      console.log(`${doorConfig.name || doorId}: `, state);
    }, 500);
  }
  door.on('opened', () => {
    registerDevice('ON');
  });
  door.on('closed', () => {
    registerDevice('OFF');
  });
}

hub.on('close', (had_error) => {
  console.log("closed hub connection", had_error);
});

hub.httpClient(hubConfig, () => {
  console.log("connected to hub at " + hubConfig.host);
  setupMqtt();
  for (let doorId in doors) {
    setupDoor(doorId);
  }
});

// express routes:
// app.get('/light/:id/on', function(req, res){
//   let lastLevel;
//   let id = req.params.id;
//   if (lights[id]) lastLevel = lights[id].lastLevel
//   hub.light(id).turnOn(lastLevel)
//   .then(function (status) {
//     if(status.response) {
//       res.sendStatus(200);
//     } else {
//       res.sendStatus(404);
//     }
//   });
// });
// 
// app.get('/light/:id/off', function(req, res){
//   var id = req.params.id;
//   hub.light(id).level( (err, curLevel) => {
//     lights[id] = lights[id] || {};
//     lights[id].lastLevel = curLevel;
//     hub.light(id).turnOff()
//     .then(function (status) {
//       if(status.response) {
//         res.sendStatus(200);
//       } else {
//         res.sendStatus(404);
//       }
//     });
//   });
// });
let express = require('express');
let mqtt = require('mqtt')
let Insteon = require('home-controller').Insteon;
let nconf = require('nconf');

nconf.file(__dirname + '/config.json');
let lights = nconf.get('lights');
const hubConfig = nconf.get('hub');
const mqttBroker = nconf.get('mqtt:url');
const mqttOpts = nconf.get('mqtt:options');

let app = express();
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
            lights[light.id] = lights[light.id] || {};
            if (curLevel > 0) {
              lights[light.id].lastLevel = curLevel;
            }
            const deviceState = {
              state: (curLevel > 0 ? 'ON' : 'OFF'),
              brightness: Math.round(curLevel * 2.55),
            }
            mqttClient.publish(`homelights/${light.id}/state`, JSON.stringify(deviceState));
            console.log(`${lightName}: `, deviceState);
          });
        }
        updateLightState();
        if (!lights[light.id].bound) {
          lights[light.id].bound = true;
          light.on('command', updateLightState);
        }
      }
    });
  });
}

hub.httpClient(hubConfig, function(){
  console.warn("connected to hub");
  app.listen(3000);
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
    updateLinksInterval = setInterval(setupLinks, 120000);
  })
  mqttClient.on("message", function (topic, rawMsg) {
    let msg = JSON.parse(rawMsg);
    console.log(topic, msg);
    const lightIdRes = topic.match(/homelights\/(.+)\/state\/set/);
    if (lightIdRes[1]) {      
      const lightId = lightIdRes[1];
      if (msg.state == 'OFF' || msg.brightness === 0) {
        hub.light(lightId).turnOff();
      } else {
        if (msg.brightness) { // && msg.brightness!==255
          const level = Math.round(msg.brightness / 2.55)
          hub.light(lightId).turnOn(level);
          lights[lightId].lastLevel = level;
        } else {
          console.log("resuming brightness: ", lights[lightId].lastLevel );
          hub.light(lightId).turnOn(lights[lightId].lastLevel);
        }
      }
    }
    
  })

});

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
require('easy-profiler');
const fs = require('fs');

class API {
  constructor(baseUrl, key, agent) {
    this.host = baseUrl;
    this.key = key;
    this.agent = agent;
    this.http = require('http');
  }

  call(path) {
    return new Promise((resolve, reject) => {
      try{
        this.http.get({
          hostname: this.host,
          headers: {
            "X-Api-Key": this.key,
            "User-Agent": this.agent
          },
          path: path,
          agent: false
        }, (res) => {
          console.log(res.error);
          if(res.error){
            reject(res.error);
            return;
          }

          var data = "";
          res.on("data", chunk => data += chunk)
             .on("end", () => {
              data = JSON.parse(data);
              if(data.error) reject("Error " + data.status + ": " + data.error);
              else resolve(data)
            });
        });
      }catch(e){
        reject(e);
      }
    });
  }
}
const ddApi = new API("api.discorddungeons.me", "5bf8e070-86aa-4296-89ee-2121d0f3e837", "LogaLyze");

class User {
  constructor(id, analyzer) {
    this.id = id;
    this.pauseDuration = analyzer.pauseDuration;
    this.messages = [];
    this.dates = [];
    this.commands = {};
  }

  save() {
    return new Promise((resolve, reject) => {
      var conv = this.convertedRanges;
conv.push(
`
The player took ${conv.length} pause${conv.length != 1 ? "s" : ""} that ${conv.length != 1 ? "were" : "was"} ${this.pauseDuration} hours or longer over the span of ${analyzer.daysExisted(this).toFixed(2)} days.
The player has played ${(analyzer.playPercentage(this)*100).toFixed(2)}% of the time (s)he has existed.
Longest time played in a row was ${analyzer.longestPeriod(this).toFixed(2)} days.
pauses/days played: ${analyzer.pausesPerDay(this).toFixed(2)}
Note: Not having a significant pause over the course of a day is very suspicious considering sleep is a thing we humans kinda do.`
);

var s =
`${this.messages.join("\n")}

-Time ranges (no break longer than ${this.pauseDuration} ${this.pauseDuration != 1 ? "hours" : "hour"})-
${conv.join("\n")}`;

      fs.mkdir(`user messages/${this.ranges.length - 1}`, (err) => {
        if(err && err.code != 'EEXIST') reject(err);
        fs.writeFile(`user messages/${this.ranges.length - 1}/${this.id}${analyzer.shouldFlag(this) ? "_flagged" : ""}.txt`, s, (err) => {
          if(err) reject(err);
          resolve();
        });
      });
    });
  }

  get ranges() {
    if(this.cached_ranges) return this.cached_ranges;
    var limit = this.pauseDuration*60*60*1000;
    var first;
    var prev;
    var results = [];
    for(let ms of this.dates) {
      first = first ? first : ms;
      prev = prev ? prev : ms;

      if(ms - prev > limit) {
        results.push([first, prev]);
        first = undefined;
      }

      prev = ms;
    }

    if(first) {
      results.push([first, prev]);
    }

    this.cached_ranges = results;
    return results;
  }

  get convertedRanges() {
    return this.ranges.map(a => (new Date(a[0]).toUTCString()) + " --> " + (new Date(a[1]).toUTCString()));
  }
}

class Analyzer {
  constructor(logs, pauseDuration) {
    this.logs = logs;
    this.pauseDuration = pauseDuration;

    this.users = {};
    this.lastLogged; // The time of the last message logged in milliseconds.
  }

  get userArray() {
    var array = [];
    for(let id of Object.keys(this.users)){
      array.push(this.users[id]);
    }

    return array;
  }

  dayDifference(a, b) {
    return Math.abs((a - b)/(24*60*60*1000));
  }

  daysExisted(user) {
    return this.dayDifference(user.ranges[0][0], this.lastLogged);
  }

  timeExisted(user) {
    return this.lastLogged - user.ranges[0][0];
  }

  pausesPerDay(user) {
    return user.ranges.length / this.dayDifference(user.ranges[0][0], user.ranges[user.ranges.length - 1][1]);
  }

  timePlayed(user) {
    return user.ranges.map(range => range[1] - range[0]).reduce((a, b) => a + b);
  }

  playPercentage(user) {
    return this.timePlayed(user)/this.timeExisted(user);
  }

  longestPeriod(user) {
    var longest = -1;
    user.ranges.forEach((a) => {
      var cur = a[1] - a[0];
      longest = cur > longest ? cur : longest;
    });

    return longest/(1000*60*60*24);
  }

  shouldFlag(user) {
    return (this.playPercentage(user) >= 1 - (this.pauseDuration/24) || this.longestPeriod(user) > 1) && this.daysExisted(user) >= 1 && user.messages.length > 500;
  }

  process() {
    return new Promise(resolve => {
      var subprocess = function(file){
        return new Promise((subresolve, subreject) => {
          EP.begin("read-file");
          fs.readFile(file, (err, data) => {
            EP.end("read-file");
            if(err) subreject(err);
            var content = data.toString();
            var regex = /^\[(.*?)\] (.*?) used by\s.*?\s\((\d+)\).*?$/gm;
            var matches, output = [];

            EP.begin("matching");
            while(matches = regex.exec(content)){
              let user = this.users[matches[3]];
              if(!user){
                user = new User(matches[3], this);
                this.users[matches[3]] = user;
              }

              user.messages.push(matches[0]);
              user.dates.push(Date.parse(matches[1]));
              let c = user.commands[matches[2]];
              user.commands[matches[2]] = c ? c + 1 : 1;
              this.lastLogged = Date.parse(matches[1]);
            }
            EP.end("matching");
            subresolve();
          });
        });
      }.bind(this);

      var generator = function* (temp){
        for(let log of this.logs){
          console.log("Log being processed: " + log);
          yield subprocess(log).then(() => {temp.gen.next()}).catch(console.log);
        }
        console.log("Analyze finished!");
        resolve();
      }.bind(this);

      var temp = {}; temp.gen = generator(temp);
      temp.gen.next();
    });
  }
}

function query(question) {
  return new Promise(resolve => {
    process.stdin.resume();
    process.stdout.write(question + "\n");
    process.stdin.once("data", data => {
      resolve(data.toString().trim());
    });
  });
}


// run the stuff
var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
query("Which month's logs do you want to analyze? [" + MONTHS.join(", ") + "] (Type it exactly as it says here)")
  .then(month => {
    if(MONTHS.indexOf(month) == -1){
      ddApi.call(month).then(console.log).catch(console.log);
      return;
    }

    fs.readdir("logs/" + month, (err, files) => {
      if(err){
        console.log(err);
        return;
      }
      indexed = files.map((v, k) => (k+1) + ". " + v);
      console.log(indexed.join("\n"));
      query("Which log(s) do you want to analyze? e.g.: '1-4', '2'")
        .then(response => {
          try{
            var single = /^(\d+)$/;
            var range = /(\d+)-(\d+)/;
            let a, b;
            if(response.match(single)){
              a = parseInt(RegExp.$1);
              b = a;
            }else if(response.match(range)){
              a = parseInt(RegExp.$1);
              b = parseInt(RegExp.$2);
            }

            var chosen = [];
            for(var i = a - 1; i <= b - 1; i++){
              chosen.push(files[i]);
            }
            chosen = chosen.map(f => "logs/" + month + "/" + f);
          }catch(e){
            console.log(e);
          }

          query("How long should a proper pause be defined as? (In hours, think in terms of sleep)")
            .then(hours => {
              analyzer = new Analyzer(chosen, hours);
              analyzer.process().then(() => {
                EP.report(true);
                query("Save flagged users or all users? (all/enter for flagged)")
                  .then(response => {
                    try{
                      let userArray = analyzer.userArray;
                      if(response != "all"){
                        if(response.match(/^\d+$/)){
                          userArray = userArray.filter(user => user.id === response);
                        }else{
                          userArray = userArray.filter(user => analyzer.shouldFlag(user));
                        }
                      }


                      var generator = function* (temp){
                        console.log("Saving " + userArray.length + " users...");
                        for(let user of userArray){
                          yield user.save().then(() => {temp.gen.next()}).catch(console.log);
                        }

                        console.log("Done, saved " + userArray.length + " users.");
                      }.bind(this);

                      var temp = {}; temp.gen = generator(temp);
                      temp.gen.next();

                    }catch(e){ console.log(e); }
                  });
              });
            });
        });
    });
  });

// 133237389802995713
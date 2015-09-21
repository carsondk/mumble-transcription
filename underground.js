var YoutubeFinder = function (apiKey) {
    var self = this;
    this.fs = require('fs');
    this.youtubedl = require('youtube-dl');
    this.ffmpeg = require('fluent-ffmpeg');

    var YouTube = require('youtube-node');
    this.youTube = new YouTube();


    var sqlite3 = require('sqlite3').verbose();
    this.db = new sqlite3.Database('music.sqlite3', function() {
        self.db.run("CREATE TABLE IF NOT EXISTS music (id INTEGER PRIMARY KEY, title TEXT, youtubeId TEXT)");
        self.db.run("CREATE TABLE IF NOT EXISTS search (id INTEGER PRIMARY KEY, searchString TEXT, youtubeId TEXT)");

    });

    var yaml = require('js-yaml');
    console.log(__dirname + '/config.yml');
    try {
        var config = yaml.safeLoad(this.fs.readFileSync(__dirname + '/config.yml'));
        console.log(config);
    } catch (e) {
        console.log(e);
    }
    
    this.youTube.setKey(config.youtube.apiKey);

    this.cacheDirectory = "mp3cache";
}

YoutubeFinder.prototype.playFromSearch = function(search, callback) {
    var self = this;
    this.db.get("SELECT youtubeId FROM search WHERE searchString='"+search+"'", function(error, row) {
        if (error) {
            console.log("error accessing database: " + error);
        } else {
            if (row == undefined) {
                console.log("Didn't find search string in database");
                self.youtubeSearch(search, callback);
            } else {
                console.log("Search in database, attempting to play");
                self.play(row.youtubeId, callback);
            }
        }
    });
}

YoutubeFinder.prototype.youtubeSearch = function (search, callback) {
    var self = this;
    this.youTube.search(search, 1, function(error, result) {
      if (error) {
        console.log(error);
      }
      else {
        var videoId = result.items[0].id.videoId;
        self.db.run("INSERT INTO search (searchString, youtubeId) VALUES ('"+search+"','"+result.items[0].id.videoId+"')");
        self.play(videoId, callback);
      }
    });
}

YoutubeFinder.prototype.play = function(videoId, callback) {
    var self = this;
    console.log("Attempting to play: " + videoId);
    this.db.get("SELECT youtubeId FROM music WHERE youtubeId='"+videoId+"'", function (error, row) {
        if (error) {
            console.log("error accessing database");
        } else {
            if (row == undefined) {
                console.log("Didn't find youtubeId in database");
                self.download(videoId, function(videoId) {
                    callback(self.cacheDirectory+"/"+videoId+".mp3");
                });
            } else {
                console.log("Video in database, playing");
                callback(self.cacheDirectory+"/"+row.youtubeId+".mp3");
            }
        }
    });
}

YoutubeFinder.prototype.download = function (videoId, callback) {
    var self = this;
    var video = this.youtubedl('http://www.youtube.com/watch?v='+videoId,
      // Optional arguments passed to youtube-dl.
      ['--format=18'],
      // Additional options can be given for calling `child_process.execFile()`.
      { cwd: __dirname });

    // Will be called when the download starts.
    video.on('info', function(info) {
      console.log('Download started');
      console.log('filename: ' + info.filename);
      console.log('size: ' + info.size);
    });

    proc = this.ffmpeg(video)
        .on('end', function() {
            console.log('Done writing to mp3');
            self.db.run("INSERT INTO music (youtubeId) VALUES ('"+videoId+"')");
            callback(videoId);
        })
        .on('error', function(err) {
            console.log('An error happened: ' + err.message);
        })
        .save(self.cacheDirectory+"/"+videoId + ".mp3");

}

var finder = new YoutubeFinder();
finder.playFromSearch("Firework", function(file) {
    console.log("Time to play: "+file);
})


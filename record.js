
"use strict";

var Recorder = function (connection, speechFunction) {
    connection = typeof connection !== 'undefined' ? connection : null;
    this.speechFunction = typeof speechFunction !== 'undefined' ? speechFunction : null;

    var self = this;
    this.stream = require('stream');

    var fs = require( 'fs' );
    this.mumble = require('mumble');
    this.ffmpeg = require('fluent-ffmpeg');

    var yaml = require('js-yaml');
    console.log(__dirname + '/config.yml');
    try {
        self.config = yaml.safeLoad(fs.readFileSync(__dirname + '/config.yml'));
        console.log(self.config);
    } catch (e) {
        console.log(e);
    }

    var apiai = require('apiai');
    this.app = apiai(this.config.apiai.clientToken, this.config.apiai.clientKey);

    var Slack = require('node-slack');
    this.slack = new Slack(this.config.slack.hookUrl);


    var unique = Date.now() % 10;
    this.streams = new Object();

    if (connection !== null) {
        console.log("Got a connection");
        this.connection = connection;
        this.initConnection();
    } else {
        console.log("Creating my own connection");
        this.mumble.connect( this.config.mumble.url, function( error, connectionRet ) {
            if( error ) { throw new Error( error ); }
            self.connection = connectionRet;
            self.connection.on( 'initialized', function() {
                self.initConnection();
            });
            self.connection.authenticate('record-' + unique);
        });

    }

}

Recorder.prototype.initConnection = function() {
    var self = this;
    var users = this.connection.users();
    for (var u in users) {
        var user = users[u];
        var username = user.name;
        self.streams[user.session] = user.outputStream(true);
    }

    this.connection.on('user-disconnect', function(user) {
        console.log("User " + user.name + " disconnected");
        self.streams[user.session] = null; 
    });
    this.connection.on('user-connect', function(user) {
        console.log("User " + user.name + " connected");
        self.streams[user.session] = user.outputStream(true);
    });
    this.connection.on('user-move', function(user, fromChannel, toChannel, actor) {
        console.log("User " + user.name + " moved from channel " + fromChannel.name + " to " + toChannel.name);
        if (toChannel.name == self.connection.user.channel.name) {
            console.log("Moved to my channel, adding stream...");
            self.streams[user.session] = user.outputStream(true);
        } else {
            self.streams[user.session] = null;
        }
    });


    this.connection.on('voice-end', function(data) {
        console.log('voice-end ' + data.session + " " + data.name + " " + data.talking);

        var user = self.connection.userBySession(data.session);

        self.convert_and_send(user, function () {
            // this is to create a readable stream again after consuming the last thing said
            // I think there is a race condition here between completing conversion and beginning to speak again
            // I couldn't get it to present in practice though, spamming mic press as fast as I could
            self.streams[user.session] = user.outputStream(true);
            //self.streams[user.session].readable = true;
        });
    });

}


// I had to use a passthrough stream here because it looks like ffmpeg end is not based on
// stream ending. Got the end event before stream was actually done writing, and would
// chop off end of voice.
// This could all be fixed by making the voiceRequest streamable

Recorder.prototype.convert_and_send = function (user, complete) {
    var self = this;

// set up the apiai request
    var request = this.app.voiceRequest();

    request.on('response', function(response) {
        console.log(response);
        if( response.status.errorType === "success") {
            if(self.speechFunction != null) {
                self.speechFunction(response, user);
            } else {
                self.slack.send({
                    text: response.result.resolvedQuery,
                    channel: self.config.slack.channel,
                    username: user.name
                });
            }
        }
    });

    request.on('error', function(error) {
        console.log(error);
    });

// set up a mediator pipe between apiai request and ffmpeg, described above
    var passThrough = new this.stream.PassThrough();
    passThrough.pipe(request.request, {end: false});

    passThrough.on('end', function() {
        request.end();
    });

    this.ffmpeg_convert(this.streams[user.session], passThrough, complete);

}

Recorder.prototype.ffmpeg_convert = function (inputStream, outputStream, complete) {
    var proc = this.ffmpeg(inputStream)
        .on('end', function() {
            console.log('done processing input stream');
            complete();
        })
        .on('error', function(err) {
            console.log('an error happened: ' + err.message);
        })
        .on('progress', function(progress) {
            console.log('Processing: ' + progress.percent + '% done');
        })
        .inputOptions(
            '-f',  's16le',
            '-ar', '48k',
            '-ac', '1'
        )
        .output(outputStream)
        .outputOptions(
            '-acodec', 'pcm_s16le',
            '-ar', '16k',
            '-ac', '1')
        .format('wav')
        .run()
}

//var recorder = new Recorder();

module.exports = Recorder;


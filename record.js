
"use strict";

var stream = require('stream');

var fs = require( 'fs' );
var mumble = require('mumble');
var ffmpeg = require('fluent-ffmpeg');

var yaml = require('js-yaml');
console.log(__dirname + '/config.yml');
try {
    var config = yaml.safeLoad(fs.readFileSync(__dirname + '/config.yml'));
    console.log(config);
} catch (e) {
    console.log(e);
}

var apiai = require('apiai');
var app = apiai(config.apiai.clientToken, config.apiai.clientKey);

var Slack = require('node-slack');
var slack = new Slack(config.slack.hookUrl);


var unique = Date.now() % 10;
var streams = new Object();

var connection;

mumble.connect( config.mumble.url, function( error, connectionRet ) {
    if( error ) { throw new Error( error ); }

    connection = connectionRet;

    connection.authenticate('record-' + unique);
    connection.on( 'initialized', function() {
        var users = connection.users();
        for (var u in users) {
            var user = users[u];
            var username = user.name;

            streams[user.session] = user.outputStream(true);
        }
    });
    connection.on('user-disconnect', function(user) {
        console.log("User " + user.name + " disconnected");
        streams[user.session] = null; 
    });
    connection.on('user-connect', function(user) {
        console.log("User " + user.name + " connected");
        streams[user.session] = user.outputStream(true);
    });
    connection.on('user-move', function(user, fromChannel, toChannel, actor) {
        console.log("User " + user.name + " moved from channel " + fromChannel.name + " to " + toChannel.name);
        if (toChannel.name == connection.user.channel.name) {
            console.log("Moved to my channel, adding stream...");
            streams[user.session] = user.outputStream(true);
        } else {
            streams[user.session] = null;
        }
    });


    connection.on('voice-end', function(data) {
        console.log('voice-end ' + data.session + " " + data.name + " " + data.talking);

        var username = data.name;
        convert_and_send(data);
    });
});


// I had to use a passthrough stream here because it looks like ffmpeg end is not based on
// stream ending. Got the end event before stream was actually done writing, and would
// chop off end of voice.
// This could all be fixed by making the voiceRequest streamable

function convert_and_send(user) {
    console.log(user);
    var filename = user.session + Date.now() + ".wav";

// set up the apiai request
    var request = app.voiceRequest();

    request.on('response', function(response) {
        console.log(response);
        if( response.status.errorType === "success") {
            slack.send({
                text: response.result.resolvedQuery,
                channel: config.slack.channel,
                username: user.name
            });
        }
    });

    request.on('error', function(error) {
        console.log(error);
    });

// set up a mediator pipe between apiai request and ffmpeg, described above
    var passThrough = new stream.PassThrough();
    passThrough.pipe(request.request, {end: false});

    passThrough.on('end', function() {
        request.end();
    });

    ffmpeg_convert(streams[user.session], passThrough);

}

function ffmpeg_convert(inputStream, outputStream) {
    var proc = ffmpeg(inputStream)
        .on('end', function() {
            console.log('done processing input stream');
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


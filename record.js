
"use strict";

var fs = require( 'fs' );
var mumble = require('mumble');
var ffmpeg = require('fluent-ffmpeg');

var apiai = require('apiai');
var app = apiai("76f825fd55dc4c399885c51b081401f4", "913a8022-2cc4-4ae3-aa54-6484a7b7567e");

var Slack = require('node-slack');
var slack = new Slack("https://hooks.slack.com/services/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");


var unique = Date.now() % 10;
var streams = new Object();

var connection;

mumble.connect( process.env.MUMBLE_URL, function( error, connectionRet ) {
    if( error ) { throw new Error( error ); }

    connection = connectionRet;

    connection.authenticate('record-' + unique);
    connection.on( 'initialized', function() {
        var users = connection.users();
        for (var u in users) {
            var user = users[u];
            var username = user.name;

            //var userConn = connection.userByName( username );
            console.log( user.session );
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
        make_mp3(data);
    });
});

function make_mp3(user) {
    console.log(user);
    var filename = user.session + Date.now() + ".wav";

    var proc = ffmpeg(streams[user.session])
        .on('end', function() {
            console.log('done processing input stream');
            var userConn = connection.userBySession( user.session );
            streams[user.session] = userConn.outputStream(true);
            speech2text(filename, user.name);
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
        .save(filename).outputOptions(
            '-acodec', 'pcm_s16le',
            '-ar', '16k',
            '-ac', '1');

}

function speech2text (filename, username) {
    console.log("Sending off for speech2text");
   
    var request = app.voiceRequest();

    request.on('response', function(response) {
        console.log(response);
        //connection.user.channel.sendMessage(username + ": " + response.result.resolvedQuery)
        if( response.status.errorType === "success") {
            slack.send({
                text: response.result.resolvedQuery,
                channel: '#stenographer',
                username: username
            });
        }
    });

    request.on('error', function(error) {
        console.log(error);
    });

    fs.readFile(filename, function(error, buffer) {
        if (error) {
            console.log(error);
        } else {
            request.write(buffer);
        }

        request.end();
    });
}


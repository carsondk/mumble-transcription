
"use strict";

var fs = require( 'fs' );
var mumble = require('mumble');
var lame = require( 'lame' );

var apiai = require('apiai');
var app = apiai("76f825fd55dc4c399885c51b081401f4", "913a8022-2cc4-4ae3-aa54-6484a7b7567e");
var request = app.voiceRequest();

request.on('response', function(response) {
    console.log(response);
});

request.on('error', function(error) {
    console.log(error);
});


var unique = Date.now() % 10;

mumble.connect( process.env.MUMBLE_URL, function( error, connection ) {
    if( error ) { throw new Error( error ); }

    connection.authenticate('record-' + unique);
    connection.on( 'initialized', function() {
        var user = connection.userByName( 'Dynofight' );
        console.log( user.session );
        var stream = user.outputStream(true);
        stream.pipe( fs.createWriteStream('./Dynofight.pcm'));
    });


    connection.on('voice-end', function(data) {
        console.log('voice-end' + data.session + " " + data.name + " " + data.talking);
        make_mp3("Dynofight");
    });
});

function make_mp3(user_name) {
    var encoder = new lame.Encoder({
        // input
        channels: 1,
        bitDepth: 16,
        sampleRate: 48000,

        // output
        bitRate: 128,
        outSampleRate: 16000,
        mode: lame.MONO
    });

    var input = fs.createReadStream(user_name + ".pcm");
    input.pipe(encoder);

    var output = fs.createWriteStream(user_name + ".mp3");
    encoder.pipe(output);

    //fs.readFile(user_name + ".mp3", function(error, buffer) {
    //if (error) {
    //    console.log(error);
    //} else {
    //    request.write(buffer);
    //}

    //request.end();
    //});
}


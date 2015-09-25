"use strict";

var mumble = require('mumble');
var fs = require('fs');

var yaml = require('js-yaml');
console.log(__dirname + '/config.yml');
try {
    var config = yaml.safeLoad(fs.readFileSync(__dirname + '/config.yml'));
    console.log(config);
} catch (e) {
    console.log(e);
}

var options = {
//    key: fs.readFileSync( 'private.pem' ),
//    cert: fs.readFileSync( 'public.pem' )
}

var YoutubeFinder = require('./underground.js');
var youtubeFinder = new YoutubeFinder();
var lame = require('lame');
var Speaker = require('speaker');

var Recorder = require('./record.js');

var is_talking = { };
var input_stream;

var record;

var connection;

console.log( 'Connecting' );
mumble.connect( config.mumble.url, options, function ( error, connectionIn ) {
    if( error ) { throw new Error( error ); }

    connection = connectionIn;

    connection.authenticate( 'Underground' );

    connection.on( 'initialized', function () {
        console.log('connection ready');
        record = new Recorder(connection, handleSpeech);
    });

    connection.on('voice-start', function( user ) {
        console.log( 'User ' + user.name + ' started voice transmission' );
        is_talking[user.session] = true;
        checkTalkingAdjustVolume(connection);
    });

    connection.on('user-disconnect', function(user) {
        console.log("User " + user.name + " disconnected");
        is_talking[user.session] = false; 
    });

    connection.on('user-move', function(user, fromChannel, toChannel, actor) {
        is_talking[user.session] = false;
    });


    connection.on('voice-end', function( user ) {
        console.log( 'User ' + user.name + ' ended voice transmission' );
        is_talking[user.session] = false;
        checkTalkingAdjustVolume(connection);
    });

    connection.on('message', function(message, actor) {
        if( handleCommand( message, actor, connection ) ) {
            return;
        }

        actor.sendMessage("I received: '" + message + "'");
        connection.user.channel.sendMessage("I received: '" + message + "'");
    });

    input_stream = connection.inputStream({gain: .25});


});

var handleSpeech = function(response, user) {

    switch (response.result.action) {
        case 'play':
            var message = response.result.resolvedQuery.slice(17);
            console.log("Playing from voice: "+ message);
            handleCommand("!play " + message, user, connection);
            break;
        default:
    }
}

var checkTalkingAdjustVolume = function (context) {
    var someoneTalking = false;
    for (var k in is_talking) {
        if(is_talking.hasOwnProperty(k)) {
            console.log(k+"  "+is_talking[k])
            someoneTalking = someoneTalking || is_talking[k];
        }
    }
    if(someoneTalking) {
        console.log("Setting volume .5");
        //setVolume(.5);
        input_stream.setGain(.05);
    } else {
        //setVolume(1);
        console.log("Setting volume 1");
        input_stream.setGain(.25);
    }
};

var commands = [
    {
        command: /!channel permissions: (.*)/,
        action: function( context, channelName ) {
            var channel = context.connection.channelByName( channelName );
            if( !channel ) {
                return context.actor.sendMessage( 'Unknown channel: ' + channelName );
            }

            channel.getPermissions( function( err, permissions ) {
                if( err ) { return context.actor.sendMessage( 'Error: ' + err ); }
                context.actor.sendMessage( channelName + ' permissions: ' + JSON.stringify( permissions ) );
            });
        }
    },
    {
        command: /!msg ([^:]+): (.*)/,
        action: function( context, names, message ) {

            var recipients = { };

            names = names.split( ',' );
            for( var n in names ) {
                var name = names[n];

                var user = context.connection.userByName( name );
                if( user ) {
                    if(!recipients.hasOwnProperty('session')) { recipients.session = [];}
                    recipients.session.push( user.session );
                }

                var channel = context.connection.channelByName( name );
                if( channel ) {
                    if(!recipients.hasOwnProperty('channel')) { recipients.channel = [];}
                    recipients.channelId.push( channel.id );
                }
            }

            context.connection.sendMessage( message, recipients );
        }
    },
    {
        command: /!join (.+)/,
        action: function( context, name ) {

            var channel = context.connection.channelByPath( name );
            channel.join();
        }
    },
    {
        command: /!play (.+)/,
        action: function( context, search ) {

            youtubeFinder.playFromSearch(search, function(file) {
                console.log("Time to play: "+file);
                fs.createReadStream(file)
                    .pipe(new lame.Decoder)
                    .on('format', console.log)
                    .pipe(input_stream);
            });

        }
    },

];

var handleCommand = function( message, actor, connection ) {
    for( var c in commands ) {
        var cmd = commands[c];

        var match = cmd.command.exec( message );
        if( !match ) {
            continue;
        }

        var params = match.slice(1);
        params.unshift({ message: message, actor: actor, connection: connection });
        cmd.action.apply( null, params );

        return true;
    }
};

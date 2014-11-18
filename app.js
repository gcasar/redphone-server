//Rapid prototyping with NodeJS!

var MONGO_DB = 'mongodb://localhost/redphone'
var GCM_PORT = 9000;
var UDP_PORT = 9999;

var http = require('http');
var mongoose = require('mongoose');
var colors = require('colors');
var gcm = require('node-gcm');
var dgram = require('dgram');

var sender = new gcm.Sender('AIzaSyCfxNWMbRrSCd_56fNJcjDcooAFP75W1oM');

//MISIC

colors.setTheme({
  silly: 'rainbow',
  input: 'grey',
  verbose: 'cyan',
  prompt: 'grey',
  info: 'green',
  data: 'grey',
  help: 'cyan',
  warn: 'yellow',
  debug: 'blue',
  error: 'red'
});

mongoose.connect(MONGO_DB);


//SCHEMAS

var Schema = mongoose.Schema;
var ObjectId = Schema.ObjectId;


var clientSchema = mongoose.Schema({
	address: {type: String, index:{ unique:true, required : true, dropDups: true}},
	gcmToken: String,
	updated: {type: Date, default: Date.now}
});

var clientConnectionSchema = mongoose.Schema({
	publicIP: String,
	publicPort: Number,
	localIP: String,
	localPort: Number,
	client: {type: mongoose.Schema.ObjectId, ref: 'Client'},
	created: {type: Date, default: Date.now},
});

var p2pConnectionSchema = mongoose.Schema({
	created: {type: Date, default: Date.now},
	initiator: {type: mongoose.Schema.ObjectId, ref: 'ClientConnection'},
	target: {type: mongoose.Schema.ObjectId, ref: 'ClientConnection'},
});

var Client = mongoose.model('Client', clientSchema);
var ClientConnection = mongoose.model('ClientConnection', clientConnectionSchema);
var P2pConnection = mongoose.model('P2pConnection', p2pConnectionSchema);


var db = mongoose.connection;

db.on('error', console.error.bind(console, 'Open DB: '+ 'ERR'.error));
db.once('open', function callback(){
	console.log('Open DB: '+ 'OK'.info);
});

//GCM notif init
function sendHelloMessage(gcmToken, address){
	var message = new gcm.Message({
	    data: {
	        'address': address
	    
	    }
	});

	var registrationIds = [gcmToken];
	sender.send(message, registrationIds, 4, function (err, result) {
		if(err)console.log("GCM".debug+ " ERR ".error+ (""+result).data);
	    else console.log("GCM".debug+(""+result).data);
	});

}


//GCM registrations via HTTP
var server = http.createServer(function(request,response){
	var payload = '';
    request.on('data', function(chunk) {
    	payload += chunk.toString();
    });
    
    request.on('end', function() {
    	parseRequest(payload,response);
    });

});

server.listen(GCM_PORT);

var gcmTokens = [];

function parseRequest(payload, response){
	
	try{
		var msg = JSON.parse(payload);
		if(msg.action==undefined){
			throw "No action field"; 
		}else if(msg.action=="register"){
			handleRegister(msg,response);
		}else{
			throw "Bad action field";
		}
	}catch(err){

		console.log("WEB ".debug+(""+err).data);
		response.writeHead(400,{"Content-Type": "application/json"});
		response.end("{'err':'400'}\n");
	}
}

function handleRegister(msg,res){
	console.log("WEB ".debug+JSON.stringify(msg).data);
	Client.update({address: msg.address}, {gcmToken: msg.gcmToken}, {upsert:true},
		function(err){
			res.writeHead(200, {"Content-Type": "application/json"});
			res.end(JSON.stringify({'error':err,'ap':msg.address}));
			if(err){
				console.log("ERR ".error+err);
			}else{
				console.log("OK ".info+(""+msg.address).verbose+" updated");
				//sendHelloMessage(msg.gcmToken);
				gcmTokens[msg.address] = msg.gcmToken;
			}
		});
}

//https://github.com/jankolkmeier/node-upd-hole-punching/blob/master/rendezvous.js

//UDP punching
var udp_matchmaker = dgram.createSocket('udp4');
var udp_port = UDP_PORT;


var clients = {};
var targets = {};

udp_matchmaker.on('listening', function() {
	var address = udp_matchmaker.address();
	console.log('UDP '.debug, address.address, address.port);
});

udp_matchmaker.on('message', function(data, rinfo) {
	try {
		data = JSON.parse(data);
	} catch (e) {
		return console.log('UDP '.debug + 'ERR '.error + 'Couldn\'t parse data (%s):\n%s', e, data);
	}
	if (data.msg == 'ADDR') {
		//override with latest
		clients[data.address] = {
			target: data.target,
			publicIp: rinfo.address,
			publicPort: rinfo.port,
			localIp: data.localIp,
			localPort: data.localPort,
			address: data.address,
		}
		//add new
		//"*" as a target string indicates any
		targets[data.address+data.target]=clients[data.address];




    	console.log('# Client registered: %s@[%s:%s | %s:%s]', data.address,
                rinfo.address, rinfo.port, data.localIp, data.localPort);

    	console.log(JSON.stringify(targets).data);

		if(targets[data.target+data.address]!=undefined){
			//we have a connection waiting for us
			//remove from general connections
			console.log("# found target:"+ data.target);
			pair(targets[data.address+data.target],targets[data.target+data.address]);


			targets[data.address+data.target] = undefined;
			targets[data.target+data.address] = undefined;

		}else if(targets[data.target+"*"]!=undefined){
			// try to connect to a general connection

			console.log("# found target:"+ data.target);

			pair(targets[data.address+data.target], targets[data.target+"*"]);


			targets[data.target+"*"] = undefined;
			targets[data.address+data.target] = undefined;
		}else{
			//try to wake the other machine
    		if(gcmTokens[data.target]!=undefined)
    			sendHelloMessage(gcmTokens[data.target], data.address);
		}
    

	} else if (data.type == 'connect') {
    	var couple = [ clients[data.from], clients[data.to] ] 
    	for (var i=0; i<couple.length; i++) {
      		if (!couple[i]) return console.log('Client unknown!');
    	}
    
    	for (var i=0; i<couple.length; i++) {
    		send(couple[i].connections.public.address, couple[i].connections.public.port, {
        		type: 'connection',
        		client: couple[(i+1)%couple.length],
      		}); 
    	}
  	}
});

function pair( a, b ){
	var msg = b;
	var data = new Buffer(JSON.stringify(msg));

	console.log( "## sending: "+data);

	udp_matchmaker.send(data, 0, data.length, a.publicPort, a.publicIp, function(err, bytes){
		if (err) {
	      console.log('# error pairing: %s', err);
	    } else {
	      console.log('# sent '+msg.type);
	    }
	});


	msg = a;
	data = new Buffer(JSON.stringify(msg));


	console.log( "## sending: "+data);

	udp_matchmaker.send(data, 0, data.length,b.publicPort, b.publicIp, function(err, bytes){
		if (err) {
	      console.log('# error pairing: %s', err);
	    } else {
	      console.log('# sent '+msg.type);
	    }
	});
}

udp_matchmaker.bind(udp_port);

//Rapid prototyping with NodeJS!

var MONGO_DB = 'mongodb://localhost/redphone'
var GCM_PORT = 9000;
var UDP_PORT = 9999;

var http = require('http');
var mongoose = require('mongoose');
var colors = require('colors');
var gcm = require('node-gcm');

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
	client: {type: mongoose.Schema.ObjectId, ref: 'client'},
	created: {type: Date, default: Date.now},
});

var p2pConnectionSchema = mongoose.Schema({
	created: {type: Date, default: Date.now},
	initiator: {type: mongoose.Schema.ObjectId, ref: 'clientConnection'},
	target: {type: mongoose.Schema.ObjectId, ref: 'clientConnection'},
});

var Client = mongoose.model('Client', clientSchema);
var ClientConnection = mongoose.model('ClientConnection', clientConnectionSchema);
var P2pConnection = mongoose.model('P2pConnection', p2pConnectionSchema);


var db = mongoose.connection;

db.on('error', console.error.bind(console, 'Open DB: '+ 'ERR'.error));
db.once('open', function callback(){
	console.log('Open DB: '+ 'OK'.info);
});


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
		response.writeHead(400);
		response.end("400\n");
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
			}
		});
}

//UDP punching


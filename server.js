// ABOUT
// Runs the SyncLounge Server software - handles rooms 
// Defaults to 8089

// V1.1

// USER CONFIG
var PORT = 8089





// END USER CONFIG
var express = require('express');
var path = require('path');
var cors = require('cors')

var root = express()
root.use(cors())

var combined = express()

var ptserver = express();

// Setup our PTServer
ptserver.get('/',function(req,res){
    return res.send("You've connected to the SLServer, you're probably looking for the webapp.")
})

// Merge everything together

root.use('/slserver',ptserver)
root.get('*',function(req,res){
    return res.send('You\'ve connected to the SLServer, you\'re probably looking for the webapp.')
})





var rootserver = require('http').createServer(root);
var ptserver_io = require('socket.io')(rootserver,{path: '/slserver/socket.io'});


ptserver_io.on('connection', function(socket){
    console.log('Someone connected to the ptserver socket')

    socket.on('join',function(data){
        //A user is attempting to join a room    
        if (data == null){
            return
        }    
        if (!data || !data.username || !data.room){
           return socket.emit('join-result',false,{},'wrong password',[])
        }
        var tempUser = new user()
        var result = true
        var _data = {}
        var details = "Successfully connected to " + data.room 

        if (socket.selfUser != null || socket.selfUser != undefined){
            //Already in a room! Leave the room we're in
            handleDisconnect(false)
        }
        var room = ptserver_io.sockets.adapter.rooms[data.room]
        let isFresh = false
        if (room === undefined || room.users === undefined || room.users === null){
            isFresh = true  
            socket.join(data.room)
            room = ptserver_io.sockets.adapter.rooms[data.room]
            room.users = []                  
            room.password = data.password   
            tempUser.role = 'host'
            tempUser.username = getValidUsername([],data.username)
        } else {
            tempUser.username = getValidUsername(room.users,data.username)
            if (room.password == null || room.password == ''){            
                //Check if we've already got a Host
                if (room.hostUsername == null){
                    // We dont have a host user yet.
                    // This should never happen..
                    room.hostUsername = tempUser.username
                    tempUser.role = 'host'
                    socket.join(data.room)               
                } else {
                    tempUser.role = 'guest'
                    socket.join(data.room)
                }  
            } else {
                //This room has a password
                if (room.password == data.password){
                    //Good password!                 
                    if (room.hostUsername == null){
                        //We dont have a host user yet.
                        console.log('We dont have a host user')
                        room.hostUsername = tempUser.username     
                        tempUser.role = 'host'
                        socket.join(data.room)          
                    } else {
                        tempUser.role = 'guest'
                        socket.join(data.room)
                    }
                } else {
                    result = false
                    details = 'wrong password'
                }
            }
        }

        
        tempUser.avatarUrl = data.avatarUrl
        
        //We've sorted out where the user should go, lets send back
        var currentUsers = null
        if (result){
            tempUser.room = data.room
            console.log('User ' + tempUser.username  + ' joined ' + tempUser.room)
            if (tempUser.role == 'host'){
                room.hostUsername = tempUser.username
            }
            room.users.push(tempUser)
            console.log('they joined OK and were given the username ' + tempUser.username)

            socket.broadcast.to(data.room).emit('user-joined',room.users,tempUser)
            //Set some objects on the socket for ease of use down the road
            socket.ourRoom = data.room
            socket.selfUser = tempUser
            currentUsers = room.users
        } else {
            console.log('User failed to join a room')
        }     
        _data = tempUser
        socket.emit('join-result',result,_data,details,currentUsers)
    })
	socket.on('poll', function(data){
        if (socket.ourRoom == null){
            //console.log('This user should join a room first')
            socket.emit('flowerror','You aren\' connected to a room! Use join')
            socket.emit('rejoin')
            return
        }
        //Recieved an update from a user
        updateUserData(socket.selfUser.username,data,socket.selfUser.room)
        //var users = io.sockets.adapter.rooms['hotline123'].users
        //console.log(JSON.stringify(io.sockets.adapter.rooms, null, 2))
        /*var clients_in_the_room = io.sockets.adapter.rooms[roomId]; 
        for (var clientId in clients_in_the_room ) {
            //console.log('client: %s', clientId); //Seeing is believing 
            var client_socket = io.sockets.connected[clientId];//Do whatever you want with this
        }
        */


        socket.emit('poll-result',ptserver_io.sockets.adapter.rooms[socket.selfUser.room].users)
        var room = ptserver_io.sockets.adapter.rooms[socket.selfUser.room]
        if (socket.selfUser.role == 'host'){
            //We're the host, broadcast to all clients our data
            var temp = {}
            temp.time = data.time
            temp.maxTime = data.maxTime
            temp.title = data.title
            temp.rawTitle = data.rawTitle
            temp.lastHeartbeat = (new Date).getTime()
            temp.playerState = data.playerState
            temp.clientResponseTime = data.clientResponseTime
            temp.type = data.type
            temp.showName = data.showName
            socket.broadcast.to(socket.selfUser.room).emit('host-update',temp)
        }
    });
    socket.on('send_message',function(msg){
        //console.log(msg)
        if (socket.ourRoom == null){
            //console.log('This user should join a room first')
            socket.emit('flowerror','You aren\' connected to a room! Use join')
            socket.emit('rejoin')
            return
        }
        //console.log('New message in channel ' + socket.selfUser.room + ' from ' + socket.selfUser.username + ' saying ' + msg)
        socket.broadcast.to(socket.selfUser.room).emit('new_message',{
            msg: msg.msg,
            user: {
                username: socket.selfUser.username,
                thumb: socket.selfUser.avatarUrl
            },
            type: msg.type
        })
    })
    socket.on('transfer_host',function(data){
        if (socket.ourRoom == null){
            //console.log('This user should join a room first')
            socket.emit('flowerror','You aren\' connected to a room! Use join')
            socket.emit('rejoin')
            return
        }
        console.log("Hi there", data)
        transferHost(socket.selfUser, function (user){ return user.username == data.username })
    })
    socket.on('connect_timeout',function(){
        //console.log('timeout')
        handleDisconnect(true)
    })
	socket.on('disconnect', function(){        
       handleDisconnect(true)
	});
    function handleDisconnect(disconnect){
        if (socket.selfUser === undefined || socket.selfUser === null){
            return
        }
        //console.log('User left: ' + socket.selfUser.username)
        transferHost(socket.selfUser, function (user){ return user != socket.selfUser })
        removeUser(socket.selfUser.room,socket.selfUser.username)
        if (ptserver_io.sockets.adapter.rooms[socket.selfUser.room]){
            socket.broadcast.to(socket.selfUser.room).emit('user-left',ptserver_io.sockets.adapter.rooms[socket.selfUser.room].users,socket.selfUser)
        }        
        socket.disconnect(disconnect)           
    }
    function updateUserData(username,userData,room){
        for (var i in ptserver_io.sockets.adapter.rooms[room].users){
            var user = ptserver_io.sockets.adapter.rooms[room].users[i]
            if (user.username == username){
                //This is our user
                user.time = userData.time
                user.maxTime = userData.maxTime
                user.title = userData.title
                user.lastHeartbeat = (new Date).getTime()
                user.playerState = userData.playerState
                user.rawTitle = userData.rawTitle
                user.clientResponseTime = userData.clientResponseTime
                user.type = userData.type
                user.showName = userData.showName
                return
            }
        }
    }
    function transferHost(user, newHostPredicate){
        if (user.role != 'host') {
            console.log('Not transfering host in room', user.room, 'from', user.username, 'because its role is', user.role)
            return
        }
        var room = ptserver_io.sockets.adapter.rooms[user.room]
        if (!room) {
            console.log('Not transfering the host in the room', user.room, 'because the room was already destroyed')
            return
        }
        var newHost = room.users.find(newHostPredicate)
        if (!newHost) {
            console.log('Not transfering host in room', user.room, 'from', user.username, 'because suitable user found')
            return
        }
        console.log('Transfering host in room', user.room, 'from', user.username, 'to', newHost.username)
        user.role = 'guest'
        newHost.role = 'host'
        room.hostUser = newHost
        room.hostUsername = newHost.username
        socket.broadcast.to(user.room).emit('host-swap', newHost)
    }
    function removeUser(roomname,username){
        var room = ptserver_io.sockets.adapter.rooms[roomname]
        if (room === undefined){
            return
        }
        for (var i in room.users){
            if (room.users[i].username == username){
                //This is the user that we need to remove
                room.users.splice(i,1)
            }
        }
    }
    function getValidUsername(usersarray,wantedname){
        var tempname = wantedname
        while (true){
            //We need to loop through the users list until we create a valid name
            var found = false;
            for (var i in usersarray){
                if (usersarray[i].username == tempname){
                    //console.log(usersarray[i].username + ' == ' + tempname)
                    found = true;
                }
            }
            if (found){
                //Looks like that username is taken
                //Check if we've already appended '(x)'
                if (tempname.indexOf('(') > -1){
                    //we have
                    var value = parseInt(tempname.substring(
                        tempname.indexOf('(')+1,tempname.indexOf(')')))
                    var newvalue = value + 1
                    tempname = tempname.replace('('+value+')','('+newvalue+')')
                } else {
                    //we haven't
                    tempname = tempname + '(1)'
                }
            } else {
                //This is a valid name!
                return tempname
            }
        }
    }

    var user = function(){
        this.username = null;
        this.role = null;
        this.room = null;
        this.title = null;
        this.time = null;
        this.avatarUrl = null;
    }
});
rootserver.listen(PORT);
console.log('SyncLounge Server successfully started on port ' + PORT)




setInterval(function(){
   console.log('Connected users: ' + Object.keys(ptserver_io.sockets.connected).length)
},5000)







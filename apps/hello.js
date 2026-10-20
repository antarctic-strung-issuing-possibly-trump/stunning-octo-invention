var express = require('express'),
    async = require('async'),
    { Pool } = require('pg'),
    cookieParser = require('cookie-parser'),
    app = express(),
    server = require('http').Server(app),
    io = require('socket.io')(server);

var port = process.env.PORT || 7000;

io.on('connection', function (socket) {

  socket.emit('message', { text : 'Welcome!' });

  socket.on('subscribe', function (data) {
    socket.join(data.channel);
  });
});

var pool = new Pool({
  connectionString: 'postgres://postgres:postgres@db/postgres'
});

async.retry(
  {times: 1000, interval: 1000},
  function(callback) {
    pool.connect(function(err, client, done) {
      if (err) {
        console.error("Waiting for db");
      }
      callback(err, client);
    });
  },
  function(err, client) {
    if (err) {
      return console.error("Giving up");
    }
    console.log("Connected to db");
    getVotes(client);
  }
);

function getVotes(client) {
  client.query('SELECT vote, COUNT(id) AS count FROM votes GROUP BY vote', [], function(err, result) {
    if (err) {
      console.error("Error performing query: " + err);
    } else {
      var votes = collectVotesFromResult(result);
      io.sockets.emit("scores", JSON.stringify(votes));
    }

    setTimeout(function() {getVotes(client) }, 1000);
  });
}

function collectVotesFromResult(result) {
  var votes = {a: 0, b: 0};

  result.rows.forEach(function (row) {
    votes[row.vote] = parseInt(row.count);
  });

  return votes;
}

app.use(cookieParser());
app.use(express.urlencoded());
app.use(express.static(__dirname + '/views'));

app.get('/', function (req, res) {
  res.sendFile(path.resolve(__dirname + '/views/index.html'));
});

// --- VULNERABLE SPECIFIC VOTE API ENDPOINT FOR WORKLOAD PROTECTION DEMO ---
app.get('/api/vote/:name', function (req, res) {
  var voteName = req.params.name;

  // VULNERABILITY: Direct string concatenation instead of parameterized queries ($1)
  // This allows the user to break out of the quotes and append arbitrary SQL commands.
  // urlEncode('; COPY (SELECT 1) TO PROGRAM 'whoami' --)
  var query = "SELECT COUNT(id) AS count FROM votes WHERE vote = '" + voteName + "'";

  pool.query(query, function(err, result) {
    if (err) {
      console.error("Error performing API query: " + err);
      // Returning the error message helps visualize the SQL syntax errors during testing
      return res.status(500).json({ error: "Database error", details: err.message });
    }

    var voteCount = 0;
    if (result.rows && result.rows.length > 0) {
      voteCount = parseInt(result.rows[0].count);
    }

    res.json({ vote: voteName, count: voteCount });
  });
});

server.listen(port, function () {
  var port = server.address().port;
  console.log('App running on port ' + port);
});

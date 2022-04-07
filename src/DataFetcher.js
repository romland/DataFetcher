import fs from 'fs';
import axios from 'axios';
import UserAgent from 'user-agents';

export default class DataFetcher
{
	config;
	seedDataColumnIndices;
	seedDataColumnNames;

	static getDefaultConfiguration()
	{
		return {
			// Decent defaults?
			runType : "DEFAULT",							// Cosmetic only, e.g. "DRY" or "REAL" run.
			taskInterval : 2000,							// How long to pause between running tasks.
			taskBackOffMinutes : 1,							// How long to back off if rate-limit condition is met.
			randomizeSeedOrder : true,						// Randomize the order of the imported data.
			randomizeUserAgent : true,						// Randomize the user-agent for each request.
			remoteProxy : undefined,						// Proxy settings if needed (likely). This is passed as-is to axios (see their documentation).

			seedDataFormat : {
				format : "CSV",								// What format is the seed data in?
				lineTerminator : "\r\n",					// The line terminator to use when reading the seed data.
				separator : ","								// The field separator to use when reading the seed data.
			},

			/**
			 * Below are things that you likely want to set yourself.
			 */
			seedFilename : "seeds.csv",						// The CSV file containing the seed data.
			destFilename : "done.txt",						// The file to write the fetched data to.
			remoteServiceUrl : 'https://httpbin.org/post',	// The URL to POST to.
			fetchEnabled : false,							// Whether or not to fetch data (can be useful to test read/write data).

			/**
			 * Methods with sane defaults. But please override.
			 */
			 getBodyToPassToRemoteServer : (seedRow) => {
				// WARNING:
				// This sends all of the seedRow to remote service, which you 
				// might not want as it might reveal who you are or what you
				// are up to.
				return new URLSearchParams(seedRow);
			},

			queryRateLimit : (response, seedRow) => {
				// Default: no rate limiting.
				return false;
			},

			mutateImportedSeedRow : (seedRow) => {
				// Mutate a jsut imported seedRow in place. By default do nothing.
			},
		};
	}


	constructor(config)
	{
		this.config = config;

		this.verifyConfig();

		if(this.config.seedDataFormat.format !== "CSV") {
			throw new Error("Only CSV format is supported for now.");
		}

		this.seedDataColumnIndices = Object.values(config.relevantSeedDataColumns);
		this.seedDataColumnNames = Object.keys(config.relevantSeedDataColumns);
	}


	verifyConfig()
	{
		const mandatoryFields = [ 
			'taskInterval', 'taskBackOffMinutes', 'randomizeSeedOrder', 'randomizeUserAgent', 'runType', 'seedFilename', 
			'destFilename', 'remoteServiceUrl', 'fetchEnabled', 'relevantSeedDataColumns', "seedDataFormat",
			// Methods
			'getBodyToPassToRemoteServer', 'queryRateLimit', 'mutateImportedSeedRow'
		];
	
		for(let i = 0; i < mandatoryFields.length; i++) {
			if(!this.config.hasOwnProperty(mandatoryFields[i])) {
				throw new Error(`Missing mandatory field: ${mandatoryFields[i]}`);
			}
		}
	}
	

	run()
	{
		console.log(`Starting ${this.config.runType} run...`);
	
		const doneRecords = this.getDoneRecords(this.config.destFilename);
		const seedData = this.getSeedDataCSV(this.config.seedFilename, this.config.seedDataFormat.lineTerminator, this.config.seedDataFormat.separator);
	
		if(this.config.randomizeSeedOrder) {
			// Shuffle the order of the records in the seed-data
			this.shuffle(seedData);
		}

		let sleepUntil = 0;
		let scrapeInterval = null;
		let taskRunning = false;
		let response, nowStr;

		let currentLine = 0;			// Start line
		let endLine = seedData.length;	// Change to just do a test of a smaller number of lines. TODO: Make this configurable.
	
		console.debug("Running from line ", currentLine, " to ", endLine, "in seeddata");

		const Task = async () => {
			// Did we somehow start a task while one was running?
			if(taskRunning) {
				console.debug("Already running a task, skipping...");
				sleepUntil = Date.now() + 200;
				return;
			}
	
			taskRunning = true;
	
			nowStr = new Date().toLocaleTimeString();;

			// Are we at the end?
			if(currentLine >= endLine) {
				clearInterval(scrapeInterval);
				console.log(nowStr, "All records done. Last line was", currentLine);
	
				taskRunning = false;
				return;
			}

			// Are we currently expected to sleep? (e.g. rate-limited)
			if(Date.now() < sleepUntil) {
				console.debug(nowStr, "Sleeping another", Math.round((sleepUntil - Date.now()) / 1000 / 60), "minutes" );
	
				taskRunning = false;
				return;
			}
	
			// Have we fetched this before?
			if(this.isFetched(doneRecords, seedData[currentLine])) {
				console.debug(nowStr, "Skip line", currentLine, "id:", seedData[currentLine].id, "data:", this.getRelevantFields(seedData[currentLine]) );
	
				currentLine++;
				taskRunning = false;
				Continue();
				return;
			}

			// Fetch the data from the remote service.
			try {
				response = await this.fetchRemoteRecord(seedData[currentLine]);
			} catch(ex) {
				console.debug(nowStr, "Exception fetching record; will retry in a bit...");
	
				// Some error. Sleep 3 intervals in case there is an outage somewhere.
				sleepUntil = Date.now() + this.config.taskInterval * 3;
				taskRunning = false;
				Continue();
				return;
			}
	
			// Check for rate-limiting.
			if(this.config.queryRateLimit(response, seedData[currentLine])) {
				console.log(nowStr, "Rate limited. Backing off for ", this.config.taskBackOffMinutes, "minutes");
	
				sleepUntil = Date.now() + (this.config.taskBackOffMinutes * 60 * 1000);
				taskRunning = false;
				return;
			}
	
			// Add the seed data to persisted record for easier refinement.
			response._seedrow = seedData[currentLine];

			// Save the record to disk.
			console.debug(nowStr, "Line", currentLine, "Saving", seedData[currentLine].id, response);
			fs.appendFileSync(this.config.destFilename, JSON.stringify(response) + "\n");
			doneRecords.push({...this.getRelevantFields(seedData[currentLine])});
	
			// Don't add any extra sleep before running next task. Standard interval is the decider.
			sleepUntil = Date.now();
			currentLine++;
			taskRunning = false;
		};

		// To easily kill current interval and restart it (for an immediate continue)
		const Continue = () => {
			if(scrapeInterval !== null) {
				clearInterval(scrapeInterval);
			}
	
			scrapeInterval = setInterval(Task, this.config.taskInterval);
	
			// Run the first task immediately.
			Task();
		};

		// Really just for clarification. Starting and continuing a task is the same.
		const Start = Continue;

		// Start doing the tasks.
		Start();
	}

	
	/**
	 * TODO:
	 * This is a very naive implementation of reading a CSV file.
	 * It does not handle quoted fields, or escaped separators.
	 */
	getSeedDataCSV(fileName, lineTerm = "\r\n", sep = ",")
	{
		let ret = [];
		const csv = fs.readFileSync(fileName, 'utf8');
		const lines = csv.split(lineTerm);
	
		// skip first line (column names)
		for(let i = 1; i < lines.length; i++) {
			let line = lines[i].split(sep);
	
			let newRec = {};
			for(let j = 0; j < this.seedDataColumnIndices.length; j++) {
				newRec[this.seedDataColumnNames[j]] = line[this.seedDataColumnIndices[j]];
			}
	
			// Give it an ID indicating its original index in the CSV
			newRec.id = i;
	
			// Include complete original line for refining later
			newRec.org = lines[i];

			this.config.mutateImportedSeedRow(newRec);
	
			ret.push(newRec);
		}
	
		return ret;
	}
	
	
	getDoneRecords(fileName)
	{
		if(!fs.existsSync(fileName)) {
			return [];
		}
	
		let doneTxt = fs.readFileSync(fileName, 'utf8')
		let doneArr = doneTxt.split("\n");
		let ret = [];
		let rec;
	
		for(let i = 0; i < doneArr.length; i++) {
			if(!doneArr[i]) {
				break;
			}
			rec = JSON.parse(doneArr[i]);
	
			let newDoneRec = {};
			for(let j = 0; j < this.seedDataColumnIndices.length; j++) {
				newDoneRec[this.seedDataColumnNames[j]] = rec._seedrow[this.seedDataColumnNames[j]];
			}
			ret.push(newDoneRec);
		}
	
		return ret;
	}
	
	
	async fetchRemoteRecord(seedRow)
	{
		const body = this.config.getBodyToPassToRemoteServer(seedRow);
	
		let response;
	
		if(this.config.fetchEnabled) {
			try {
				response = await axios({
						url : this.config.remoteServiceUrl,
						method : "POST",
						data : body.toString(),
						headers: {
							"User-Agent" : 
								this.config.randomizeUserAgent
									? (new UserAgent()).toString()
									: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/74.0.3729.169 Safari/537.36",
							"Accept" : "application/json, text/javascript, */*; q=0.01",
							"Accept-Encoding": "deflate, gzip;q=1.0, *;q=0.5",
							"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
						},
						proxy: this.config.proxy,
					}
				);
			} catch(ex) {
				console.error(ex, ex.message);
				throw "Exception getting remote data (see above)";
			}
		} else {
			// TODO: Make configurable. Be able to simulate this with a passed in function 
			// if we're not calling the remote service
			console.warn("Fetch disabled. Pretending to get remote data.");

			response = {
				data : {
					fetchEnabled : false,
					triggerModalUrl : "",
					body : body.toString()
				}
			};
		}
	
		return response.data;
	}
	

	isFetched(doneRecords, seedRow)
	{
		for(let i = 0; i < doneRecords.length; i++) {
			let matchCount = 0;
			this.seedDataColumnNames.forEach(function(colName) {
				if(doneRecords[i][colName] === seedRow[colName]) {
					matchCount++;
				}
			});
	
			if(matchCount === this.seedDataColumnNames.length) {
				return true;
			}
		}
	
		return false;
	}
	
	
	shuffle(array)
	{
		let currentIndex = array.length,  randomIndex;
	
		while (currentIndex != 0) {
			randomIndex = Math.floor(Math.random() * currentIndex);
			currentIndex--;
	
			[array[currentIndex], array[randomIndex]] = [
				array[randomIndex], array[currentIndex]
			];
		}
	
		return array;
	}
	
	
	getRelevantFields(seedRow)
	{
		let ret = {};
	
		for(let i = 0; i < this.seedDataColumnIndices.length; i++) {
			ret[this.seedDataColumnNames[i]] = seedRow[this.seedDataColumnNames[i]];
		}
	
		return ret;
	}
}
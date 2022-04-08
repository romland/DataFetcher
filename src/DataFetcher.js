import fs from 'fs';
import axios from 'axios';
import UserAgent from 'user-agents';

export default class DataFetcher
{
	config;
	seedDataColumnIndices;
	seedDataColumnNames;
	cachedResponses;			// Used by post-refinement.
	cachedSeedDataColumnNames;	// Used by post-refinement.

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
			maxRecordFailCount : 5,							// How many times to retry fetching a record before giving up.
			maxFailCount : 25,								// How many consecutive fetch-failures before we abort whole run.
			sleepIntervalsAfterFail : 3,					// How many intervals to sleep after a fetch-failure (set to 0 for none).
			responseCacheFilename : "default-responsecache.json",	// The file to write the fetched data to (for recovery).
			discardBackOffResponse : false,					// Whether to discard the response that makes us back off.

			seedDataFormat : {
				format : "CSV",								// What format is the seed data in?
				lineTerminator : "\r\n",					// The line terminator to use when reading the seed data.
				separator : ","								// The field separator to use when reading the seed data.
			},

			/**
			 * Below are things that you likely want to set yourself.
			 */
			seedFilename : "seeds.csv",						// The CSV file containing the seed data.
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

			queryBackOff : (response, seedRow) => {
				// Default: no rate limiting.
				return false;
			},

			mutateImportedSeedRow : (seedRow) => {
				// Mutate a just imported seedRow in place. By default do nothing.
			},

			/**
			 * If enabled: a new file will be created together with your seed-data
			 * and the new data that was fetched. 
			 * 
			 * It is handy for the case where you want to immediately create a 
			 * new file based on seedfile, including the fetched data. If you choose
			 * to not use this functionality, you can just parse the file defined in
			 * `responseCacheFilename` yourself.
			 * 
			 * If you are enabling this, though:
			 * 
			 * Your postRunRefineRecord() method is the one that will return any
			 * new data that should be appended to the original data.
			 * 
			 * Enabling this will consume a bit more memory as all responses are
			 * cached to be passed to this function when a run is finished or aborted.
			 * 
			 * Old responses from a possible previous run will also be passed
			 * to postRunRefineRecord().
			 */
			postRunRefineEnabled : false,
			postRunRefineRecord : (response) => {
				// Does nothing by default.
				// Note that calling this is also DISABLED by default (set postRunRefineEnabled to true).
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
			'responseCacheFilename', 'remoteServiceUrl', 'fetchEnabled', 'relevantSeedDataColumns', "seedDataFormat",
			'discardBackOffResponse',
			// Methods
			'getBodyToPassToRemoteServer', 'queryBackOff', 'mutateImportedSeedRow', "postRunRefineRecord"
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

		this.cachedResponses = [];
	
		const doneRecords = this.loadFetchedRecords(this.config.responseCacheFilename);
		const seedData = this.loadSeedDataCSV(
			this.config.seedFilename,
			this.config.seedDataFormat.lineTerminator,
			this.config.seedDataFormat.separator
		);
	
		if(this.config.randomizeSeedOrder) {
			// Shuffle the order of the records in the seed-data
			this.shuffle(seedData);
		}

		let sleepUntil = 0;
		let scrapeInterval = null;
		let taskRunning = false;
		let response, nowStr;
		let currentFailCount = 0, currentRecordFailCount = 0;
		let fetchesSinceLastBackOff = 0;

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
				console.debug(nowStr, "All records done. Last line was", currentLine);

				Stop();
				taskRunning = false;
				return;
			}

			if(currentFailCount >= this.config.maxFailCount) {
				console.warn(nowStr, `Too many consecutive failures (${currentFailCount}), aborting.`);

				Stop();
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
				console.debug(nowStr, "Already fetched. Skipping", currentLine, "id:", seedData[currentLine].id, "data:", this.getRelevantFields(seedData[currentLine]) );

				currentLine++;
				taskRunning = false;
				Continue();
				return;
			}

			// Fetch the data from the remote service.
			try {
				response = await this.fetchRemoteRecord(seedData[currentLine]);
				currentFailCount = 0;
				currentRecordFailCount = 0;
				fetchesSinceLastBackOff++;
			} catch(ex) {
				// Some error while fetching.
				console.log(ex, ex.message);
				console.debug(nowStr, `Exception (${currentRecordFailCount}) fetching record; will retry in a bit...`);

				if(currentRecordFailCount >= this.config.maxRecordFailCount) {
					// Too mamany consecutive failures for this recurd, skip it.
					console.warn(nowStr, "Skipping record, too many consecutive failures", currentLine, "id:", seedData[currentLine].id, "data:", this.getRelevantFields(seedData[currentLine]) );

					// Skip this record.
					currentLine++;
					currentRecordFailCount = 0;
				} else {
					// Retry record, increase fail count.
					currentRecordFailCount++;
				}

				// Increase global fail count.				
				currentFailCount++;
				
				// Sleep a couple of intervals in case there is an outage somewhere.
				sleepUntil = Date.now() + this.config.taskInterval * this.config.sleepIntervalsAfterFail;
				taskRunning = false;

				// Continue immediately (in case sleep-intervals is 0).
				Continue();
				return;
			}

			// Check for rate-limiting (we discard this response, depending on configuration).
			let limitRate = this.config.queryBackOff(response, seedData[currentLine], fetchesSinceLastBackOff);

			if(limitRate && this.config.discardBackOffResponse === true) {
				console.warn(nowStr, "Rate limited. Discarding response and backing off for", this.config.taskBackOffMinutes, "minutes");
				fetchesSinceLastBackOff = 0;
				sleepUntil = Date.now() + (this.config.taskBackOffMinutes * 60 * 1000);
				taskRunning = false;
				return;
			}

			// Add the seed data to persisted record for easier refinement.
			response._seedrow = seedData[currentLine];

			// Save the record to disk.
			console.debug(nowStr, "Line", currentLine, "Saving", seedData[currentLine].id, response);

			// If this fails, let it crash.
			fs.appendFileSync(this.config.responseCacheFilename, JSON.stringify(response) + "\n");

			doneRecords.push({...this.getRelevantFields(seedData[currentLine])});

			if(this.config.postRunRefineEnabled === true) {
				this.cachedResponses.push(response);
			}

			if(limitRate && !this.config.discardBackOffResponse) {
				console.warn(nowStr, "Rate limited. Backing off for", this.config.taskBackOffMinutes, "minutes");
				fetchesSinceLastBackOff = 0;
				sleepUntil = Date.now() + (this.config.taskBackOffMinutes * 60 * 1000);
			} else {
				// Don't add any extra sleep before running next task. Standard interval is the decider.
				sleepUntil = Date.now();
			}

			currentLine++;
			taskRunning = false;
		};

		// Cancel current task-runner and do NOT restart.
		const Stop = () => {
			if(scrapeInterval !== null) {
				clearInterval(scrapeInterval);
			}

			if(this.config.postRunRefineEnabled === true) {
				this.postRefineCSV(this.cachedResponses, this.cachedSeedDataColumnNames);
			}
		};

		// To easily kill current interval and restart it (for an immediate continue)
		const Continue = () => {
			// Or just call Stop?
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
	loadSeedDataCSV(fileName, lineTerm = "\r\n", sep = ",")
	{
		console.log("Reading seed data from", fileName);

		const csv = fs.readFileSync(fileName, 'utf8');
		const lines = csv.split(lineTerm);
		let ret = [];
	
		for(let i = 0; i < lines.length; i++) {
			if(i === 0) {
				if(this.config.postRunRefineEnabled === true) {
					this.cachedSeedDataColumnNames = lines[i];
				}

				// skip first line (column names) TODO: Make configurable
				continue;
			}

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


	loadFetchedRecords(fileName)
	{
		if(!fs.existsSync(fileName)) {
			return [];
		}

		console.log("Reading cached responses from", fileName, " NOTE: To start over fresh, delete this file.");

		let doneTxt = fs.readFileSync(fileName, 'utf8')
		let doneArr = doneTxt.split("\n");
		let ret = [];
		let rec;
		let newDoneRec;
	
		for(let i = 0; i < doneArr.length; i++) {
			if(!doneArr[i]) {
				break;
			}
			rec = JSON.parse(doneArr[i]);
	
			newDoneRec = {};
			for(let j = 0; j < this.seedDataColumnIndices.length; j++) {
				newDoneRec[this.seedDataColumnNames[j]] = rec._seedrow[this.seedDataColumnNames[j]];
			}

			if(this.config.postRunRefineEnabled === true) {
				// This is a saved response from a previous run, include it for post-processing if it is enabled.
				this.cachedResponses.push(rec);
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
					_runType : this.config.runType,
					_fetchEnabled : false,
					_body : body.toString()
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

	/**
	 * This creates a copy of loadSeedDataCSV() with new data appended.
	 */
	postRefineCSV(responses, columnNames)
	{
		const refinedFilename = this.config.seedFilename + ".refined.csv";

		// The refined file is always machine generated so should contain 
		// no additional data. It's safe to delete.
		if(fs.existsSync(refinedFilename)) {
			fs.unlinkSync(refinedFilename);
			console.debug(`Deleted ${refinedFilename}`);
		}
	
		if(this.config.randomizeSeedOrder) {
			// Undo randomized order.
			responses.sort((a, b) => {
				return a._seedrow.id - b._seedrow.id;
			});
		}
	
		let csvLine;
		let originalOrder;
	
		// Re-assemble the seed CSV file with fetched data appended to each record.
		for(let i = 0; i < responses.length; i++) {
			/*
			 * We expect this call to return an object like this:
			 * 	{
			 * 		additionalFieldName1 : additionalFieldValue1,
			 * 		additionalFieldName2 : additionalFieldValue2
			 * 	}
			 */
			let newData = this.config.postRunRefineRecord(responses[i]);

			if(i === 0) {
				// First row means we should write the column names to destination file.
				let cols = columnNames
					+ this.config.seedDataFormat.separator
					+ Object.keys(newData).join(this.config.seedDataFormat.separator);

				cols += this.config.seedDataFormat.lineTerminator;
			
				// Write the column names to file (always first line in a CSV file).
				fs.appendFileSync(refinedFilename, cols);

				originalOrder = Object.keys(newData);
			} else {
				// Verify that the order of the keys is the same as first row.
				let currentKeys = Object.keys(newData);
				if(currentKeys.length !== originalOrder.length) {
					throw "Post-refine function returned an object with a different number of keys than the first row.";
				}

				for(let i = 0; i < currentKeys.length; i++) {
					if(currentKeys[i] !== originalOrder[i]) {
						throw "Post-refine function returned an object with a different order of keys than the first row.";
					}
				}
			}
			
			// Start the line with the original data.
			csvLine = responses[i]._seedrow.org;
			
			// Append the new data
			csvLine += this.config.seedDataFormat.separator
				+ Object.values(newData).join(this.config.seedDataFormat.separator);

			// Terminate line
			csvLine += this.config.seedDataFormat.lineTerminator;

			fs.appendFileSync(refinedFilename, csvLine);
		} // for each response
	
		console.log("Created", refinedFilename);
	}
}